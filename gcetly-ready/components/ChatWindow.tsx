"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Mic, MicOff, Square, Loader2, ChevronDown } from "lucide-react";
import Header from "./Header";
import StatusBanner from "./StatusBanner";
import QuickActions from "./QuickActions";
import MessageBubble, { type DisplayMessage } from "./MessageBubble";
import { streamChatRequest, requestNewSession } from "@/lib/chatClient";
import { isTamil } from "@/lib/language";
import { useVoiceInput } from "@/lib/useVoiceInput";
import {
  saveHistory,
  loadHistory,
  clearHistory,
  saveConversation,
  createConversationId,
  type PersistedMessage,
} from "@/lib/localHistory";
import type { ChatMessage } from "@/lib/types";
import { MAX_MESSAGE_LENGTH } from "@/lib/types";

const WELCOME_EN =
  "Hello — I’m the **GCE-TLY AI Assistant**.\n\nAsk about admissions, courses, hostel, fees, placements, or contacts. I answer from official college information and will say when something needs to be checked on the website.\n\nPick a topic below or type your question.";
const WELCOME_TA =
  "வணக்கம் — நான் **GCE-TLY AI உதவியாளர்**.\n\nசேர்க்கை, படிப்புகள், விடுதி, கட்டணம், வேலைவாய்ப்பு, தொடர்பு என அதிகாரப்பூர்வ தகவல் உதவும். உறுதிப்படுத்த வேண்டியவை இணையதளத்தில் பார்க்கச் சொல்லுவேன்.\n\nகீழே ஒரு தலைப்பைத் தேர்ந்தெடுக்கவும் அல்லது கேள்வியை எழுதவும்.";

function freshWelcome(language: "en" | "ta"): DisplayMessage {
  return { role: "assistant", content: language === "ta" ? WELCOME_TA : WELCOME_EN };
}

export default function ChatWindow() {
  // v2.0: resume the person's last conversation from this browser, rather
  // than always starting blank -- see lib/localHistory.ts for exactly what
  // this does and does not mean for privacy/session isolation.
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    return [freshWelcome("en")];
  });
  const [restoredFromHistory, setRestoredFromHistory] = useState(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Default light; restore an explicit preference on mount
  const [darkMode, setDarkMode] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<"en" | "ta">("en");
  const [sessionId, setSessionId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const handleVoiceResult = useCallback((transcript: string) => {
    setInput((prev) => (prev ? prev + " " + transcript : transcript));
  }, []);
  const { voiceState, voiceError, start: startVoice, stop: stopVoice, supported: voiceSupported } = useVoiceInput(
    uiLanguage,
    handleVoiceResult
  );

  useEffect(() => {
    requestNewSession().then(setSessionId);
    setConversationId((id) => id || createConversationId());
    // Restore local history AFTER the initial render, client-side only
    if (!restoredFromHistory) {
      const restored = loadHistory();
      if (restored && restored.length > 0) {
        setMessages(restored as DisplayMessage[]);
      }
      setRestoredFromHistory(true);
    }
    // Theme: localStorage preference, otherwise light
    try {
      const saved = localStorage.getItem("gcetly-theme");
      if (saved === "light") setDarkMode(false);
      else if (saved === "dark") setDarkMode(true);
    } catch { /* ignore */ }
    setThemeReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme to <html> so page background + Tailwind dark: variants work
  useEffect(() => {
    if (!themeReady) return;
    const root = document.documentElement;
    root.classList.toggle("dark", darkMode);
    root.dataset.theme = darkMode ? "dark" : "light";
    try {
      localStorage.setItem("gcetly-theme", darkMode ? "dark" : "light");
    } catch { /* ignore */ }
  }, [darkMode, themeReady]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Auto-scroll only if user is already near the bottom (don't yank while reading up)
    if (distanceFromBottom < 120 || streaming) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, streaming]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollDown(distanceFromBottom > 140);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Persist after every settled change -- deliberately NOT while a message
  // is still streaming, so a reload mid-answer doesn't save a half-written
  // response as if it were the final one.
  useEffect(() => {
    if (!restoredFromHistory || streaming) return;
    const toPersist: PersistedMessage[] = messages
      .filter((m) => m.content && !m.isError && !m.retrying)
      .map(({ role, content, sources }) => ({ role, content, sources }));
    saveHistory(toPersist);
    if (conversationId && toPersist.some((m) => m.role === "user")) {
      saveConversation(conversationId, toPersist);
    }
  }, [messages, streaming, restoredFromHistory, conversationId]);

  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  const historyForApi = useCallback((): ChatMessage[] => {
    return messages
      .filter((m) => m.content && !m.isError)
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
  }, [messages]);

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || streaming || !sessionId) return;

      if (text.length > MAX_MESSAGE_LENGTH) {
        // Same explicit-rejection principle as the server: don't silently
        // truncate what the person typed and answer a different, shorter
        // question than the one they actually asked.
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Your message is ${text.length} characters -- please keep it under ${MAX_MESSAGE_LENGTH} and try again.`,
            isError: true,
          },
        ]);
        return;
      }

      const history = historyForApi();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let assistantIdx = -1;
      setMessages((prev) => {
        assistantIdx = prev.length;
        return [...prev, { role: "assistant", content: "", streaming: true }];
      });

      let full = "";
      await streamChatRequest(
        text,
        history,
        sessionId,
        {
          onText: (chunk) => {
            full += chunk;
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { role: "assistant", content: full, streaming: true };
              return next;
            });
          },
          onRetrying: ({ attempt, delayMs }) => {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = {
                role: "assistant",
                content: "",
                streaming: true,
                retrying: `Service busy, retrying in ${Math.round(delayMs / 1000)}s… (attempt ${attempt}/3)`,
              };
              return next;
            });
          },
          onDone: ({ sources, followUps, confidence }) => {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = {
                role: "assistant",
                content: full,
                sources,
                followUps,
                confidence,
                streaming: false,
              };
              return next;
            });
            setStreaming(false);
            abortControllerRef.current = null;
          },
          onAborted: () => {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { role: "assistant", content: full || "(stopped)", streaming: false, stopped: true };
              return next;
            });
            setStreaming(false);
            abortControllerRef.current = null;
          },
          onError: (errMsg) => {
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = { role: "assistant", content: errMsg, streaming: false, isError: true };
              return next;
            });
            setStreaming(false);
            abortControllerRef.current = null;
          },
        },
        controller.signal
      );
    },
    [input, streaming, sessionId, historyForApi]
  );

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const regenerate = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf("assistant");
      return idx >= 0 ? prev.slice(0, idx) : prev;
    });
    send(lastUser.content);
  }, [messages, send]);

  // v2.0: edit & resend -- puts the original text back in the input and
  // truncates everything from that message onward, so resending doesn't
  // leave a stale duplicate thread behind.
  const editAndResend = useCallback((originalText: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.role === "user" && m.content === originalText);
      return idx >= 0 ? prev.slice(0, idx) : prev;
    });
    setInput(originalText);
  }, []);

  // v2.0: feedback now actually persists (see app/api/feedback/route.ts)
  // instead of only flipping an icon color client-side.
  const sendFeedback = useCallback(
    (assistantIdx: number, rating: "up" | "down") => {
      const answer = messages[assistantIdx]?.content ?? "";
      const question = [...messages.slice(0, assistantIdx)].reverse().find((m) => m.role === "user")?.content ?? "";
      fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, rating, sessionId }),
      }).catch(() => {
        // Best-effort -- a failed feedback POST shouldn't interrupt the chat.
      });
    },
    [messages, sessionId]
  );

  const newChat = useCallback(async () => {
    window.speechSynthesis?.cancel();
    stopVoice();
    abortControllerRef.current?.abort();
    clearHistory();
    setConversationId(createConversationId());
    setMessages([freshWelcome(uiLanguage)]);
    setInput("");
    setStreaming(false);
    const fresh = await requestNewSession();
    setSessionId(fresh);
  }, [uiLanguage, stopVoice]);

  const toggleLanguage = () => {
    setUiLanguage((prev) => {
      const next = prev === "en" ? "ta" : "en";
      setMessages((cur) => (cur.length === 1 && cur[0].role === "assistant" ? [freshWelcome(next)] : cur));
      return next;
    });
  };

  const showQuickActions = messages.length === 1 && messages[0].role === "assistant";
  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");

  const micLabel: Record<string, string | null> = {
    idle: null,
    requesting: "Requesting mic access…",
    listening: "🔴 Listening…",
    processing: "⏳ Processing…",
    error: voiceError,
  };
  const currentMicLabel = micLabel[voiceState];

  return (
    <div
      className={[
        "relative w-full max-w-lg h-[min(680px,92vh)] flex flex-col rounded-[28px] overflow-hidden backdrop-blur-xl transition-colors duration-300",
        darkMode
          ? "bg-surface/95 border border-white/[0.08] shadow-[0_0_0_1px_rgba(47,143,255,0.06),0_25px_80px_-20px_rgba(0,0,0,0.75),0_0_60px_-20px_rgba(47,143,255,0.25)] dark"
          : "bg-white/95 border border-slate-200/80 shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_25px_80px_-20px_rgba(15,23,42,0.18)] light-chat",
      ].join(" ")}
    >
      <Header
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        onNewChat={newChat}
        language={uiLanguage}
        onToggleLanguage={toggleLanguage}
      />
      <StatusBanner language={uiLanguage} />

      <div className="relative flex-1 min-h-0 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-3 relative">
          {showQuickActions && <div className="absolute inset-0 blueprint-bg pointer-events-none z-0" aria-hidden="true" />}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://gcetly.ac.in/imgs/gcelogo.jpg"
              alt=""
              className="w-64 h-64 object-contain opacity-[0.06] dark:opacity-[0.10] grayscale"
            />
          </div>
          <div className="relative z-10 space-y-3.5" aria-live="polite" aria-relevant="additions">
            <div data-testid="message-list" className="contents">
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                isLastAssistant={i === lastAssistantIdx && !streaming}
                onRegenerate={i === lastAssistantIdx ? regenerate : undefined}
                onEditRequest={m.role === "user" ? editAndResend : undefined}
                onFeedback={m.role === "assistant" ? (rating) => sendFeedback(i, rating) : undefined}
                onFollowUpPick={(q) => send(q)}
              />
            ))}
            </div>
          </div>
        </div>
        {showScrollDown && (
          <button
            type="button"
            onClick={() =>
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
            }
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full
                       px-3 py-1.5 text-[11px] font-medium text-white/90
                       bg-surfaceRaised/95 border border-white/10 shadow-lg shadow-black/40
                       hover:border-accent/40 hover:bg-accent/15 transition-all fade-up"
            aria-label={uiLanguage === "ta" ? "கீழே செல்" : "Scroll to latest"}
          >
            <ChevronDown size={14} />
            {uiLanguage === "ta" ? "புதியவை" : "New messages"}
          </button>
        )}
      </div>

      {showQuickActions && <QuickActions onPick={(q) => send(q)} language={uiLanguage} />}

      {currentMicLabel && (
        <div
          role={voiceState === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`px-3 pb-1 text-[11px] flex items-center justify-between ${
            voiceState === "error" ? "text-red-500" : "text-slate-500 dark:text-slate-400"
          }`}
        >
          <span>{currentMicLabel}</span>
          {(voiceState === "listening" || voiceState === "requesting") && (
            <button onClick={stopVoice} className="underline" aria-label="Cancel voice input">
              Cancel
            </button>
          )}
        </div>
      )}

      {input.length > MAX_MESSAGE_LENGTH * 0.85 && (
        <div
          role={input.length > MAX_MESSAGE_LENGTH ? "alert" : "status"}
          aria-live="polite"
          className={`px-3 pb-1 text-[11px] text-right ${input.length > MAX_MESSAGE_LENGTH ? "text-red-500" : "text-slate-500 dark:text-slate-400"}`}
        >
          {input.length} / {MAX_MESSAGE_LENGTH}
        </div>
      )}

      <div className="flex items-end gap-2 p-3 border-t border-slate-200/90 dark:border-white/[0.07] bg-gradient-to-t from-slate-50 to-white dark:from-surface dark:to-surfaceRaised/40">
        <button
          onClick={() => (voiceState === "listening" ? stopVoice() : startVoice())}
          disabled={!voiceSupported && voiceState !== "error"}
          className={[
            "shrink-0 rounded-full p-3 min-w-[44px] min-h-[44px] flex items-center justify-center transition-transform active:scale-95",
            voiceState === "listening"
              ? "bg-red-500 text-white"
              : "bg-accent text-white hover:brightness-110 shadow-lg shadow-accent/25",
          ].join(" ")}
          title={
            uiLanguage === "ta"
              ? voiceSupported
                ? "குரல் உள்ளீடு"
                : "குரல் உள்ளீடு ஆதரிக்கப்படவில்லை"
              : voiceSupported
              ? "Voice input"
              : "Voice input not supported in this browser"
          }
          aria-label={
            voiceState === "listening"
              ? uiLanguage === "ta"
                ? "குரல் உள்ளீட்டை நிறுத்து"
                : "Stop voice input"
              : voiceSupported
              ? uiLanguage === "ta"
                ? "குரல் உள்ளீடு தொடங்கு"
                : "Start voice input"
              : uiLanguage === "ta"
              ? "குரல் உள்ளீடு ஆதரிக்கப்படவில்லை"
              : "Voice input not supported in this browser"
          }
        >
          {voiceState === "listening" ? (
            <MicOff size={16} />
          ) : voiceState === "requesting" || voiceState === "processing" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Mic size={16} />
          )}
        </button>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          lang={isTamil(input) ? "ta" : "en"}
          aria-label="Message input"
          data-testid="chat-input"
          placeholder={uiLanguage === "ta" ? "சேர்க்கை, விடுதி, கட்டணம் பற்றி கேளுங்கள்…" : "Ask about admissions, hostel, fees…"}
          className="composer-focus-ring flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm outline-none max-h-28
                     bg-slate-100 text-slate-900 placeholder:text-slate-400 border border-slate-200
                     dark:bg-surfaceRaised dark:text-white dark:placeholder:text-slate-500 dark:border-white/[0.06]
                     focus:ring-2 focus:ring-accent/50 focus:border-accent/40 leading-relaxed"
        />
        {streaming ? (
          <button
            onClick={stopGenerating}
            className="shrink-0 rounded-full p-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-white bg-red-500 hover:bg-red-600 transition-transform active:scale-95"
            title={uiLanguage === "ta" ? "நிறுத்து" : "Stop generating"}
            aria-label={uiLanguage === "ta" ? "உருவாக்கத்தை நிறுத்து" : "Stop generating"}
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            data-testid="btn-send"
            onClick={() => send()}
            disabled={!input.trim() || !sessionId || input.length > MAX_MESSAGE_LENGTH}
            className="shrink-0 rounded-full p-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-white
                       bg-gradient-to-br from-accent to-[#1a6fd4] hover:brightness-110 disabled:opacity-40
                       shadow-lg shadow-accent/30 transition-transform active:scale-95 disabled:active:scale-100"
            title="Send"
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        )}
      </div>

      <p className="px-3 pb-2.5 text-[9.5px] leading-snug text-slate-500 dark:text-slate-600 text-center">
        {uiLanguage === "ta"
          ? "முக்கிய முடிவுகளுக்கு gcetly.ac.in இல் உறுதிப்படுத்துங்கள்."
          : "For important decisions, verify on gcetly.ac.in · Answers use official college info"}
      </p>
    </div>
  );
}

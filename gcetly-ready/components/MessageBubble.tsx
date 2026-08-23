"use client";

import { useState } from "react";
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown, Volume2, FileText, Globe, Loader2, AlertTriangle, Square, Pencil, Bot } from "lucide-react";
import MarkdownLite from "./MarkdownLite";
import type { ChatRole, SourceRef } from "@/lib/types";
import { isTamil } from "@/lib/language";
import { isSafeUrl } from "@/lib/urlSafety";

export interface DisplayMessage {
  role: ChatRole;
  content: string;
  sources?: SourceRef[];
  streaming?: boolean;
  isError?: boolean;
  retrying?: string;
  stopped?: boolean;
  /** v2.0: rule-based suggested next questions, shown once the answer has
   * finished streaming -- see lib/followUps.ts. */
  followUps?: string[];
  /** Retrieval confidence band (high / medium / low / none). */
  confidence?: "high" | "medium" | "low" | "none";
}

export default function MessageBubble({
  message,
  isLastAssistant,
  onRegenerate,
  onEditRequest,
  onFeedback,
  onFollowUpPick,
}: {
  message: DisplayMessage;
  isLastAssistant: boolean;
  onRegenerate?: () => void;
  onEditRequest?: (text: string) => void;
  onFeedback?: (rating: "up" | "down") => void;
  onFollowUpPick?: (q: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const isUser = message.role === "user";

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const speak = () => {
    if (!("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(message.content.replace(/[#*_`>-]/g, ""));
    utter.lang = isTamil(message.content) ? "ta-IN" : "en-IN";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const react = (rating: "up" | "down") => {
    setFeedback(rating);
    onFeedback?.(rating);
  };

  return (
    <div data-testid={message.role === "user" ? "message-user" : "message-assistant"}
      className={`group flex gap-2 ${isUser ? "justify-end msg-enter-user" : "justify-start msg-enter"}`}
    >
      {!isUser && (
        <div
          className={[
            "shrink-0 w-7 h-7 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center mt-0.5 transition-colors",
            message.streaming ? "avatar-live border-accent/50" : "",
          ].join(" ")}
          aria-hidden="true"
        >
          <Bot size={14} className="text-accentSoft" />
        </div>
      )}
      <div className={`max-w-[85%] ${isUser ? "flex flex-col items-end" : ""}`}>
        <div
          role={isUser ? undefined : "article"}
          aria-label={isUser ? undefined : "Assistant response"}
          className={[
            "rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed transition-shadow duration-200",
            isUser
              ? "bg-gradient-to-br from-accent to-[#1a6fd4] text-white rounded-br-sm shadow-lg shadow-accent/30"
              : "bg-slate-100 text-slate-800 rounded-bl-sm border border-slate-200/90 shadow-sm dark:bg-surfaceRaised/90 dark:text-slate-100 dark:border-white/[0.07] dark:shadow-black/20",
            message.isError ? "border-red-400/50" : "",
            message.streaming && !isUser ? "border-accent/20" : "",
          ].join(" ")}
        >
          {isUser ? (
            <span>{message.content}</span>
          ) : message.isError ? (
            <span className="flex items-start gap-1.5 text-red-600 dark:text-red-400" role="alert">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {message.content}
            </span>
          ) : message.retrying ? (
            <span className="flex items-center gap-1.5 text-slate-400" role="status" aria-live="polite">
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              {message.retrying}
            </span>
          ) : message.streaming && !message.content ? (
            <div className="flex flex-col gap-2 py-0.5" role="status" aria-label="Thinking">
              <div className="typing-dots flex items-center h-5 px-0.5" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="space-y-1.5">
                <div className="shimmer-line h-2.5 rounded w-[85%]" />
                <div className="shimmer-line h-2.5 rounded w-[55%]" />
              </div>
            </div>
          ) : (
            <>
              <MarkdownLite text={message.content} />
              {message.streaming && <span className="stream-caret" aria-hidden="true" />}

              {message.stopped && (
                <div className="mt-1 flex items-center gap-1 text-[10.5px] text-slate-400">
                  <Square size={10} fill="currentColor" aria-hidden="true" /> Stopped
                </div>
              )}

              {/* Confidence badge -- helps users know how well the answer was grounded */}
              {!message.streaming && message.confidence && message.confidence !== "high" && (
                <div
                  className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    background:
                      message.confidence === "medium"
                        ? "rgba(234,179,8,0.12)"
                        : "rgba(239,68,68,0.12)",
                    color:
                      message.confidence === "medium" ? "#EAB308" : "#F87171",
                    border: `1px solid ${
                      message.confidence === "medium"
                        ? "rgba(234,179,8,0.3)"
                        : "rgba(239,68,68,0.3)"
                    }`,
                  }}
                  title={
                    message.confidence === "medium"
                      ? "Partial match in the local knowledge base — verify important details on the official site"
                      : "Weak or no match in the local knowledge base — treat this answer with caution"
                  }
                >
                  <AlertTriangle size={10} aria-hidden="true" />
                  {message.confidence === "medium" ? "Partial match" : "Low confidence"}
                </div>
              )}

              {message.sources && message.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
                  {message.sources.filter((s) => isSafeUrl(s.url)).map((s) => {
                    const isWeb = !s.url.includes("gcetly.ac.in");
                    const label = s.title?.trim() || s.url.replace(/^https?:\/\//, "");
                    return (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        title={s.url}
                        aria-label={`Source: ${label}${isWeb ? " (web search result)" : " (official GCE-TLY website)"}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono border max-w-[220px]"
                        style={{
                          background: isWeb ? "rgba(122,184,255,0.10)" : "rgba(23,195,162,0.12)",
                          color: isWeb ? "#7AB8FF" : "#4FE3C9",
                          borderColor: isWeb ? "rgba(122,184,255,0.30)" : "rgba(23,195,162,0.3)",
                        }}
                      >
                        {isWeb ? <Globe size={10} className="shrink-0" aria-hidden="true" /> : <FileText size={10} className="shrink-0" aria-hidden="true" />}
                        <span className="truncate">{label.slice(0, 40)}</span>
                      </a>
                    );
                  })}
                </div>
              )}

              {!message.streaming && message.content && (
                <div className="mt-1.5 flex items-center gap-2.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button onClick={copy} title="Copy" aria-label={copied ? "Copied" : "Copy response"} className="text-slate-500 hover:text-accentSoft">
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button onClick={speak} title="Read aloud" aria-label="Read response aloud" className="text-slate-500 hover:text-accentSoft">
                    <Volume2 size={12} />
                  </button>
                  {isLastAssistant && onRegenerate && (
                    <button onClick={onRegenerate} title="Regenerate" aria-label="Regenerate response" className="text-slate-500 hover:text-accentSoft">
                      <RefreshCw size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => react("up")}
                    title="Good response"
                    aria-label="Mark as good response"
                    aria-pressed={feedback === "up"}
                    className={feedback === "up" ? "text-brandTeal" : "text-slate-500 hover:text-brandTeal"}
                  >
                    <ThumbsUp size={12} />
                  </button>
                  <button
                    onClick={() => react("down")}
                    title="Poor response"
                    aria-label="Mark as poor response"
                    aria-pressed={feedback === "down"}
                    className={feedback === "down" ? "text-red-400" : "text-slate-500 hover:text-red-400"}
                  >
                    <ThumbsDown size={12} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* v2.0: edit & resend -- puts the original text back in the input
            and truncates history from this point, rather than an inline
            editable bubble (simpler, same end result). */}
        {isUser && onEditRequest && (
          <button
            onClick={() => onEditRequest(message.content)}
            aria-label="Edit and resend this message"
            className="mt-1 mr-1 flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-slate-400 hover:text-accentSoft"
          >
            <Pencil size={10} /> Edit
          </button>
        )}

        {/* v2.0: contextual follow-up suggestions after a completed answer */}
        {!isUser && !message.streaming && message.followUps && message.followUps.length > 0 && onFollowUpPick && (
          <div className="mt-2.5 space-y-1.5 fade-up">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500 px-0.5">
              Related questions
            </p>
            <div className="flex flex-wrap gap-1.5" aria-label="Suggested follow-up questions">
            {message.followUps.map((q) => (
              <button
                key={q}
                onClick={() => onFollowUpPick(q)}
                className="chip-press rounded-full px-2.5 py-1 text-[11px] border border-accent/25 text-accentSoft hover:bg-accent/10 fade-up"
              >
                {q}
              </button>
            ))}
          </div>
          </div>
        )}
      </div>
    </div>
  );
}

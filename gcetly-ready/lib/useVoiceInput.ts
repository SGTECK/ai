"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Real voice-input state machine: idle -> requesting -> listening ->
 * processing -> idle, with a distinct error state that reports WHY it
 * failed (permission denied vs. no speech vs. no mic vs. unsupported
 * browser vs. network) rather than failing silently.
 *
 * Also handles what the previous bare-bones implementation didn't:
 * - Cleans up the recognition instance and its event listeners on
 *   unmount, so a component unmounting mid-listen can't leave the
 *   microphone active or fire state updates on an unmounted component.
 * - Guards against a second start() while already listening/requesting.
 *
 * IFRAME NOTE: if this app is embedded in an iframe (e.g. on gcetly.ac.in
 * itself), the browser will only grant microphone access if the HOSTING
 * page's iframe has `allow="microphone"` in its embed tag -- that's a
 * platform permission this hook cannot grant itself. See README "Voice
 * input in an embedded iframe" for the exact markup needed.
 */

export type VoiceState = "idle" | "requesting" | "listening" | "processing" | "error";

export function useVoiceInput(language: "en" | "ta", onResult: (transcript: string) => void) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<any>(null);
  const mountedRef = useRef(true);

  const supported =
    typeof window !== "undefined" && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const safeSetState = useCallback((s: VoiceState) => {
    if (mountedRef.current) setVoiceState(s);
  }, []);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped -- fine
    }
    safeSetState("idle");
  }, [safeSetState]);

  const start = useCallback(() => {
    if (voiceState === "listening" || voiceState === "requesting") return; // guard double-start

    if (!supported) {
      safeSetState("error");
      setVoiceError("Voice input isn't supported in this browser. Please use Chrome or another supported browser.");
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      safeSetState("error");
      setVoiceError("Voice input needs a secure (HTTPS) connection.");
      return;
    }

    safeSetState("requesting");
    setVoiceError("");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = language === "ta" ? "ta-IN" : "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => safeSetState("listening");
    recognition.onaudiostart = () => safeSetState("listening");
    recognition.onspeechend = () => safeSetState("processing");

    recognition.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
      safeSetState("idle");
    };

    recognition.onerror = (e: any) => {
      const messages: Record<string, string | null> = {
        "not-allowed": "Microphone access is disabled. Please allow microphone permission in your browser settings.",
        "permission-denied": "Microphone access is disabled. Please allow microphone permission in your browser settings.",
        "no-speech": "Didn't catch that -- no speech detected. Tap the mic and try again.",
        "audio-capture": "No microphone was found on this device.",
        network: "Network issue during voice recognition. Please try again.",
        aborted: null, // user-initiated stop -- not a real error
      };
      const msg = messages[e.error] ?? "Voice input hit an unexpected error. Please try typing instead.";
      if (msg) {
        safeSetState("error");
        setVoiceError(msg);
      } else {
        safeSetState("idle");
      }
    };

    recognition.onend = () => {
      if (mountedRef.current) {
        setVoiceState((s) => (s === "listening" || s === "processing" ? "idle" : s));
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      safeSetState("error");
      setVoiceError("Couldn't start voice input: " + (err instanceof Error ? err.message : "unknown error"));
    }
  }, [voiceState, supported, language, onResult, safeSetState]);

  // Cleanup on unmount -- stop any active recognition and its listeners so
  // the microphone never stays active after the component is gone.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        recognitionRef.current?.stop();
        recognitionRef.current = null;
      } catch {
        // already stopped -- fine
      }
    };
  }, []);

  return { voiceState, voiceError, start, stop, supported };
}

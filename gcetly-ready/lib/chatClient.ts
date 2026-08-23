"use client";

import type { ChatMessage, SourceRef } from "./types";

export interface StreamCallbacks {
  onText: (chunk: string) => void;
  onRetrying?: (info: { attempt: number; maxAttempts: number; delayMs: number }) => void;
  onDone: (info: {
    sources: SourceRef[];
    language: string;
    followUps: string[];
    confidence?: "high" | "medium" | "low" | "none";
    topScore?: number;
  }) => void;
  onAborted?: () => void;
  onError: (message: string) => void;
}

// Synchronous, module-level guard against duplicate/concurrent sends -- a
// second call while one is already in flight is rejected immediately,
// before React state (which can lag a render behind a fast double-click or
// Enter-plus-click combo) would have disabled the send button yet.
let inFlight = false;

export function isStreamInFlight(): boolean {
  return inFlight;
}

export async function streamChatRequest(
  message: string,
  history: ChatMessage[],
  sessionId: string,
  callbacks: StreamCallbacks,
  abortSignal?: AbortSignal
) {
  if (inFlight) {
    callbacks.onError("Still working on your last message -- one moment.");
    return;
  }
  inFlight = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, sessionId }),
      signal: abortSignal,
    });

    if (!res.ok) {
      if (res.status === 429) {
        callbacks.onError("The AI service is temporarily busy. Please try again in a few seconds.");
        return;
      }
      const body = await res.json().catch(() => ({}));
      callbacks.onError(body.error || `Server error (${res.status})`);
      return;
    }
    if (!res.body) {
      callbacks.onError("No response stream from server.");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const evt of events) {
        const line = evt.trim();
        if (!line.startsWith("data:")) continue;
        let payload: any;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (payload.type === "text") callbacks.onText(payload.text);
        else if (payload.type === "retrying") callbacks.onRetrying?.({ attempt: payload.attempt, maxAttempts: payload.maxAttempts, delayMs: payload.delayMs });
        else if (payload.type === "done")
          callbacks.onDone({
            sources: payload.sources ?? [],
            language: payload.language,
            followUps: payload.followUps ?? [],
            confidence: payload.confidence,
            topScore: payload.topScore,
          });
        else if (payload.type === "aborted") callbacks.onAborted?.();
        else if (payload.type === "error") callbacks.onError(payload.error);
      }
    }
  } catch (err) {
    if (
      abortSignal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && /abort/i.test(err.name + " " + err.message))
    ) {
      callbacks.onAborted?.();
      return;
    }
    callbacks.onError(err instanceof Error ? err.message : "Network error reaching the assistant.");
  } finally {
    inFlight = false;
  }
}

export async function requestNewSession(): Promise<string> {
  try {
    const res = await fetch("/api/session/new", { method: "POST" });
    const data = await res.json();
    return data.sessionId as string;
  } catch {
    return crypto.randomUUID();
  }
}

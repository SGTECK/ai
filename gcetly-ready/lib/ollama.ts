import type { ChatMessage } from "./types";
import { isRetryableError, backoffDelayMs, MAX_RETRIES } from "./retryLogic";

/**
 * Local LLM client via Ollama's HTTP API.
 *
 * Speed-focused defaults (override with env):
 * - keep_alive: keep weights in RAM between requests (huge win vs cold load)
 * - num_ctx: smaller context = less KV-cache work
 * - num_predict: hard cap on output tokens (college answers stay short)
 * - low temperature / top_k: less sampling overhead, more focused answers
 * - Qwen3 "think" disabled when supported (avoids long hidden reasoning)
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120_000);

/** How long Ollama keeps the model resident after a request (e.g. "30m", "0", "-1"). */
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";

/** In production, only allow local Ollama hosts (prevents SSRF-style misconfig). */
function assertOllamaHostSafe(host: string): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.ALLOW_REMOTE_OLLAMA === "1") return;
  try {
    const u = new URL(host);
    const h = u.hostname.toLowerCase();
    const ok =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1";
    if (!ok) {
      throw new Error(
        "OLLAMA_HOST must be localhost in production (set ALLOW_REMOTE_OLLAMA=1 only for trusted private networks)."
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("OLLAMA_HOST")) throw e;
    throw new Error("Invalid OLLAMA_HOST");
  }
}


/**
 * Generation options — all overridable via env for CPU vs GPU machines.
 * Defaults bias toward *speed + short grounded answers*, not long essays.
 */
/** Zero-cost / low-RAM profile: tighter limits for CPU and small VMs. */
const FREE_MODE = process.env.FREE_MODE === "1" || process.env.FREE_MODE === "true";

function buildOptions(): Record<string, number | boolean | string> {
  // FREE_MODE / laptop: aggressive caps. Override with env if you have a GPU.
  const defaultCtx = FREE_MODE ? 1024 : 2048;
  const defaultPredict = FREE_MODE ? 128 : 256;
  const defaultTemp = FREE_MODE ? 0.15 : 0.25;

  const opts: Record<string, number | boolean | string> = {
    num_ctx: Number(process.env.OLLAMA_NUM_CTX ?? defaultCtx),
    num_predict: Number(process.env.OLLAMA_NUM_PREDICT ?? defaultPredict),
    temperature: Number(process.env.OLLAMA_TEMPERATURE ?? defaultTemp),
    top_p: Number(process.env.OLLAMA_TOP_P ?? (FREE_MODE ? 0.85 : 0.9)),
    top_k: Number(process.env.OLLAMA_TOP_K ?? (FREE_MODE ? 30 : 40)),
    num_batch: Number(process.env.OLLAMA_NUM_BATCH ?? (FREE_MODE ? 128 : 256)),
  };

  // Use all CPU threads when set; default FREE_MODE to a sensible laptop value
  const threads = process.env.OLLAMA_NUM_THREAD
    ? Number(process.env.OLLAMA_NUM_THREAD)
    : FREE_MODE
      ? 4
      : undefined;
  if (threads && threads > 0) opts.num_thread = threads;

  if (process.env.OLLAMA_NUM_GPU) {
    opts.num_gpu = Number(process.env.OLLAMA_NUM_GPU);
  }

  return opts;
}

export interface StreamChatParams {
  systemPrompt: string;
  messages: ChatMessage[];
  /** Interface compatibility with older route; ignored here. */
  useWebSearch: boolean;
  abortSignal?: AbortSignal;
}

export type StreamChatEvent =
  | { type: "text"; text: string }
  | { type: "retrying"; attempt: number; maxAttempts: number; delayMs: number }
  | { type: "done"; webSources: [] }
  | { type: "aborted" }
  | { type: "error"; error: string; retryable: boolean };

export { isRetryableStatus, isRetryableError, backoffDelayMs } from "./retryLogic";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

interface OllamaChatChunk {
  message?: { role: string; content: string; thinking?: string };
  done: boolean;
  error?: string;
}

function buildChatBody(systemPrompt: string, messages: ChatMessage[]) {
  const body: Record<string, unknown> = {
    model: MODEL,
    stream: true,
    keep_alive: KEEP_ALIVE,
    options: buildOptions(),
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  // Qwen3 / thinking models: disable chain-of-thought in the response path
  // when Ollama supports the flag (ignored harmlessly by other models).
  if (process.env.OLLAMA_THINK !== "1" && /qwen3/i.test(MODEL)) {
    body.think = false;
  }

  return body;
}

export async function* streamChat(params: StreamChatParams): AsyncGenerator<StreamChatEvent> {
  const { systemPrompt, messages, abortSignal } = params;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (abortSignal?.aborted) {
      yield { type: "aborted" };
      return;
    }

    if (attempt > 0) {
      const delay = backoffDelayMs(attempt);
      yield { type: "retrying", attempt, maxAttempts: MAX_RETRIES, delayMs: delay };
      try {
        await sleep(delay, abortSignal);
      } catch {
        yield { type: "aborted" };
        return;
      }
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
    const onCallerAbort = () => timeoutController.abort();
    abortSignal?.addEventListener("abort", onCallerAbort);

    try {
      assertOllamaHostSafe(OLLAMA_HOST);
      const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildChatBody(systemPrompt, messages)),
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const status = res.status;
        const hint =
          status === 404 ? ` -- have you run "ollama pull ${MODEL}"?` : "";
        throw Object.assign(
          new Error(`Ollama returned ${status}${hint}: ${bodyText.slice(0, 200)}`),
          { status }
        );
      }
      if (!res.body) throw new Error("Ollama returned no response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }
          if (chunk.error) throw new Error(chunk.error);
          // Only stream visible content — never dump "thinking" tokens to the user.
          if (chunk.message?.content) {
            yield { type: "text", text: chunk.message.content };
          }
        }
      }

      yield { type: "done", webSources: [] };
      return;
    } catch (err) {
      if (abortSignal?.aborted) {
        yield { type: "aborted" };
        return;
      }
      const retryable = isConnectionOrServerError(err);
      const isLastAttempt = attempt === MAX_RETRIES;
      if (retryable && !isLastAttempt) {
        continue;
      }
      yield { type: "error", error: describeOllamaError(err), retryable };
      return;
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

/**
 * Load the model into memory (and leave it there via keep_alive) so the
 * first real user message is not a cold-start. Safe to call from /api/health
 * or a startup script.
 */
export async function warmModel(): Promise<{ ok: boolean; detail: string }> {
  try {
    assertOllamaHostSafe(OLLAMA_HOST);
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: KEEP_ALIVE,
        options: {
          num_ctx: Math.min(2048, Number(process.env.OLLAMA_NUM_CTX ?? 4096)),
          num_predict: 1,
          temperature: 0,
        },
        messages: [{ role: "user", content: "ping" }],
        ...(process.env.OLLAMA_THINK !== "1" && /qwen3/i.test(MODEL)
          ? { think: false }
          : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, detail: `Warm failed ${res.status}: ${t.slice(0, 120)}` };
    }
    return { ok: true, detail: `Model ${MODEL} warmed (keep_alive=${KEEP_ALIVE})` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getOllamaConfigSummary() {
  return {
    host: OLLAMA_HOST,
    model: MODEL,
    keepAlive: KEEP_ALIVE,
    options: buildOptions(),
    thinkDisabled: process.env.OLLAMA_THINK !== "1" && /qwen3/i.test(MODEL),
  };
}

export function isConnectionOrServerError(err: unknown): boolean {
  if (isRetryableError(err)) return true;
  const message = err instanceof Error ? err.message : "";
  return /ECONNREFUSED|fetch failed|network/i.test(message);
}

export function describeOllamaError(err: unknown): string {
  const message =
    err instanceof Error ? err.message : "Unknown error calling the local model";
  if (/ECONNREFUSED|fetch failed/i.test(message)) {
    return `Can't reach Ollama at ${OLLAMA_HOST}. Is it running? Try "ollama serve" in a terminal.`;
  }
  if (/aborted|timeout|timed out/i.test(message)) {
    return "The model took longer than expected to generate a response. Please try again or verify directly on https://gcetly.ac.in.";
  }
  return message;
}

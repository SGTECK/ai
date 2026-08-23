import type { ChatMessage } from "./types";
import type { StreamChatEvent, StreamChatParams } from "./ollama";
import { isRetryableError, backoffDelayMs, MAX_RETRIES } from "./retryLogic";

/**
 * Hugging Face Inference (OpenAI-compatible router) — P8 provider flexibility.
 * https://huggingface.co/docs/api-inference
 */

const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || "";
const HF_MODEL = process.env.HF_MODEL || "openai/gpt-oss-20b";
const HF_BASE =
  process.env.HF_BASE_URL || "https://router.huggingface.co/v1";
const TIMEOUT_MS = Number(process.env.HF_TIMEOUT_MS ?? 90_000);
const FREE_MODE = process.env.FREE_MODE === "1" || process.env.FREE_MODE === "true";
const MAX_TOKENS = Number(process.env.HF_MAX_TOKENS ?? (FREE_MODE ? 256 : 512));

export function isHuggingFaceConfigured(): boolean {
  return Boolean(HF_TOKEN);
}

export function getHuggingFaceConfigSummary() {
  return {
    configured: isHuggingFaceConfigured(),
    model: HF_MODEL,
    base: HF_BASE,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

export async function* streamChatHuggingFace(
  params: StreamChatParams
): AsyncGenerator<StreamChatEvent> {
  const { systemPrompt, messages, abortSignal } = params;

  if (!HF_TOKEN) {
    yield {
      type: "error",
      error: "HF_TOKEN is not set. Add it server-side or use LLM_PROVIDER=ollama.",
      retryable: false,
    };
    return;
  }

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
    const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);
    const onAbort = () => timeoutController.abort();
    abortSignal?.addEventListener("abort", onAbort);

    try {
      const res = await fetch(`${HF_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${HF_TOKEN}`,
        },
        body: JSON.stringify({
          model: HF_MODEL,
          stream: true,
          max_tokens: MAX_TOKENS,
          temperature: FREE_MODE ? 0.2 : 0.3,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages.map((m: ChatMessage) => ({
              role: m.role,
              content: m.content,
            })),
          ],
        }),
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        throw Object.assign(
          new Error(`HuggingFace ${res.status}: ${bodyText.slice(0, 180)}`),
          { status: res.status }
        );
      }
      if (!res.body) throw new Error("HuggingFace returned no body");

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
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            yield { type: "done", webSources: [] };
            return;
          }
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = json.choices?.[0]?.delta?.content;
            if (token) yield { type: "text", text: token };
          } catch {
            /* skip partial */
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
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        isRetryableError(err) || /429|502|503|504|timeout/i.test(message);
      if (retryable && attempt < MAX_RETRIES) continue;
      yield { type: "error", error: message, retryable };
      return;
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
    }
  }
}

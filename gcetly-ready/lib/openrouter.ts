import type { ChatMessage } from "./types";
import type { StreamChatEvent, StreamChatParams } from "./ollama";
import { isRetryableError, backoffDelayMs, MAX_RETRIES } from "./retryLogic";

/**
 * OpenRouter (OpenAI-compatible) streaming client.
 * Use for free/paid cloud models when Ollama is not available (e.g. Vercel).
 * Free models are not permanent — keep Ollama as the durable fallback.
 */

const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
/** Example free ids: google/gemma-3-27b-it:free — copy exact slug from OpenRouter */
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "openrouter/free";
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 90_000);
const FREE_MODE = process.env.FREE_MODE === "1" || process.env.FREE_MODE === "true";
const MAX_TOKENS = Number(
  process.env.OPENROUTER_MAX_TOKENS ?? (FREE_MODE ? 256 : 512)
);
const TEMPERATURE = Number(
  process.env.OPENROUTER_TEMPERATURE ?? (FREE_MODE ? 0.2 : 0.3)
);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

export function isOpenRouterConfigured(): boolean {
  return Boolean(OPENROUTER_API_KEY);
}

export function getOpenRouterConfigSummary() {
  return {
    configured: isOpenRouterConfigured(),
    model: OPENROUTER_MODEL,
    base: OPENROUTER_BASE,
    maxTokens: MAX_TOKENS,
  };
}

export async function* streamChatOpenRouter(
  params: StreamChatParams
): AsyncGenerator<StreamChatEvent> {
  const { systemPrompt, messages, abortSignal } = params;

  if (!OPENROUTER_API_KEY) {
    yield {
      type: "error",
      error:
        "OPENROUTER_API_KEY is not set. Add it in .env.local or Vercel env, or switch LLM_PROVIDER=ollama.",
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
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
    const onCallerAbort = () => timeoutController.abort();
    abortSignal?.addEventListener("abort", onCallerAbort);

    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://gcetly.ac.in",
          "X-Title": process.env.OPENROUTER_APP_NAME || "GCE-TLY AI Assistant",
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          stream: true,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
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
        const status = res.status;
        let hint = "";
        if (status === 401) hint = " — check OPENROUTER_API_KEY.";
        if (status === 402) hint = " — free credits exhausted or model is paid now.";
        if (status === 429) hint = " — rate limited; try later or switch to Ollama.";
        throw Object.assign(
          new Error(`OpenRouter ${status}${hint}: ${bodyText.slice(0, 200)}`),
          { status }
        );
      }
      if (!res.body) throw new Error("OpenRouter returned no body");

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
              error?: { message?: string };
            };
            if (json.error?.message) throw new Error(json.error.message);
            const token = json.choices?.[0]?.delta?.content;
            if (token) yield { type: "text", text: token };
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
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
        isRetryableError(err) || /429|502|503|504|rate limit|timeout/i.test(message);
      if (retryable && attempt < MAX_RETRIES) continue;
      yield {
        type: "error",
        error: message,
        retryable,
      };
      return;
    } finally {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

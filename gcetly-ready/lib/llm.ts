/**
 * LLM provider switch — permanent local Ollama, optional OpenRouter / Hugging Face.
 *
 *   LLM_PROVIDER=ollama | openrouter | huggingface
 * Fallback: openrouter/hf → ollama if key missing (unless STRICT_PROVIDER=1)
 */

import {
  streamChat as streamChatOllama,
  type StreamChatParams,
  type StreamChatEvent,
  getOllamaConfigSummary,
  warmModel,
} from "./ollama";
import {
  streamChatOpenRouter,
  isOpenRouterConfigured,
  getOpenRouterConfigSummary,
} from "./openrouter";
import {
  streamChatHuggingFace,
  isHuggingFaceConfigured,
  getHuggingFaceConfigSummary,
} from "./huggingface";

export type { StreamChatParams, StreamChatEvent };
export { warmModel, getOllamaConfigSummary };

export type LlmProvider = "ollama" | "openrouter" | "huggingface";

export function getLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER || "ollama").toLowerCase().trim();
  if (raw === "openrouter" || raw === "or") return "openrouter";
  if (raw === "huggingface" || raw === "hf") return "huggingface";
  return "ollama";
}

export function getLlmStatus() {
  const provider = getLlmProvider();
  return {
    provider,
    ollama: getOllamaConfigSummary(),
    openrouter: getOpenRouterConfigSummary(),
    huggingface: getHuggingFaceConfigSummary(),
    note:
      provider === "ollama"
        ? "Ollama is the permanent zero-cost path when a machine is available."
        : "Cloud providers are optional; free tiers can change. Keep Ollama as fallback.",
  };
}

export async function* streamChat(
  params: StreamChatParams
): AsyncGenerator<StreamChatEvent> {
  const provider = getLlmProvider();
  const strict = process.env.STRICT_PROVIDER === "1";

  if (provider === "openrouter") {
    if (isOpenRouterConfigured()) {
      yield* streamChatOpenRouter(params);
      return;
    }
    if (strict) {
      yield {
        type: "error",
        error: "LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is missing.",
        retryable: false,
      };
      return;
    }
    yield* streamChatOllama(params);
    return;
  }

  if (provider === "huggingface") {
    if (isHuggingFaceConfigured()) {
      yield* streamChatHuggingFace(params);
      return;
    }
    if (strict) {
      yield {
        type: "error",
        error: "LLM_PROVIDER=huggingface but HF_TOKEN is missing.",
        retryable: false,
      };
      return;
    }
    yield* streamChatOllama(params);
    return;
  }

  yield* streamChatOllama(params);
}

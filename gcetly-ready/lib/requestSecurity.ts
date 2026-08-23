import type { ChatMessage } from "./types";
import { MAX_MESSAGE_LENGTH } from "./types";

/** Max messages accepted from the client history array. */
export const MAX_HISTORY_MESSAGES = 12;
/** Max length of a single history message content. */
export const MAX_HISTORY_CONTENT = 4000;
/** Session ids are opaque client tokens — keep short and charset-safe. */
export const MAX_SESSION_ID_LENGTH = 64;

/**
 * Strip characters that are never needed for college Q&A and can confuse
 * logs or downstream parsers (null bytes, most ASCII control chars).
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/\0/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export function isValidSessionId(id: string): boolean {
  if (!id || id.length > MAX_SESSION_ID_LENGTH) return false;
  // Allow anonymous + typical uuid/nanoid style ids
  return /^(anonymous|[A-Za-z0-9_-]+)$/.test(id);
}

/**
 * Validate and sanitize client-supplied chat history.
 * Rejects wrong roles, oversize content, and non-string fields
 * (classic vibe-code injection vector).
 */
export function sanitizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];

  const out: ChatMessage[] = [];
  for (const item of raw.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const cleaned = sanitizeText(content).slice(0, MAX_HISTORY_CONTENT);
    if (!cleaned) continue;
    out.push({ role, content: cleaned });
  }
  return out;
}

export function validateChatMessage(raw: unknown): {
  ok: true;
  message: string;
} | {
  ok: false;
  error: string;
  status: number;
} {
  if (typeof raw !== "string") {
    return { ok: false, error: "message must be a string", status: 400 };
  }
  const message = sanitizeText(raw);
  if (!message) {
    return { ok: false, error: "message is required", status: 400 };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Message is too long (${message.length} characters). Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
      status: 400,
    };
  }
  return { ok: true, message };
}

/** Basic Content-Type gate for JSON POST bodies. */
export function requireJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
}

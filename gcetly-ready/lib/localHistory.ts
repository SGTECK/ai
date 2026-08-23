"use client";

import type { ChatRole, SourceRef } from "./types";

/**
 * v2.0 feature: "remember my last conversation" across page reloads.
 *
 * IMPORTANT distinction from the server-side session-isolation guarantee
 * documented in README.md ("Why sessions are actually isolated"): that
 * guarantee is about the SERVER holding zero cross-user conversation
 * state. This is the opposite kind of storage -- it never leaves the
 * person's own browser, is never sent to any server except as ordinary
 * chat history in THEIR OWN next request (same as before), and one
 * person's local history can never become visible to a different person
 * or a different browser. It's the same category of thing as a browser
 * remembering your last-visited tab, not a memory feature on the backend.
 *
 * Wrapped defensively because localStorage can throw (private/incognito
 * mode, storage quota, disabled storage) -- every function degrades to
 * "no persistence this session" rather than crashing the app.
 */

export interface PersistedMessage {
  role: ChatRole;
  content: string;
  sources?: SourceRef[];
}

const STORAGE_KEY = "gcetly-chat-history-v1";
const MAX_PERSISTED_MESSAGES = 40; // cap so localStorage never grows unbounded

/** Pure validation/parsing, deliberately separated from the localStorage
 * call itself so it's unit-testable without a real `window` -- same
 * separation used for lib/retryLogic.ts (pure decision logic vs. the I/O
 * that uses it). */
export function parseHistoryJson(raw: string | null): PersistedMessage[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(
      (m): m is PersistedMessage => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export function saveHistory(messages: PersistedMessage[]): void {
  try {
    const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Private browsing, quota exceeded, or storage disabled -- silently
    // skip persistence rather than breaking the chat itself.
  }
}

export function loadHistory(): PersistedMessage[] | null {
  try {
    return parseHistoryJson(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clean up if storage was never accessible
  }
}

// ---------------------------------------------------------------------------
// MULTI-CONVERSATION HISTORY (v2.1) -- extends the single "resume last
// conversation" model above into a real list you can switch between,
// consistent with the same client-only, per-browser privacy stance
// documented at the top of this file. The single-conversation functions
// above are kept as-is (not removed) since parseHistoryJson etc. are still
// used for the one-time migration below and remain independently useful.
// ---------------------------------------------------------------------------

export interface Conversation {
  id: string;
  title: string;
  messages: PersistedMessage[];
  updatedAt: number;
}

const CONVERSATIONS_KEY = "gcetly-conversations-v1";
const MAX_CONVERSATIONS = 30;
const MAX_TITLE_LENGTH = 48;

/** First user message, truncated, becomes the title -- same idea as every
 * other AI chat product's auto-titling. Pure and testable on its own. */
export function deriveTitle(messages: PersistedMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return "New conversation";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > MAX_TITLE_LENGTH ? text.slice(0, MAX_TITLE_LENGTH).trimEnd() + "…" : text;
}

/** Pure validation/parsing, same separation-from-I/O pattern as
 * parseHistoryJson above -- unit-tested in tests/test-questions.ts. */
export function parseConversationsJson(raw: string | null): Conversation[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(
      (c): c is Conversation =>
        c &&
        typeof c.id === "string" &&
        typeof c.title === "string" &&
        typeof c.updatedAt === "number" &&
        Array.isArray(c.messages)
    );
    return valid;
  } catch {
    return null;
  }
}

function readConversationsRaw(): Conversation[] {
  try {
    return parseConversationsJson(window.localStorage.getItem(CONVERSATIONS_KEY)) ?? [];
  } catch {
    return [];
  }
}

function writeConversationsRaw(conversations: Conversation[]): void {
  try {
    const trimmed = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(trimmed));
  } catch {
    // private browsing / quota / disabled storage -- skip persistence
  }
}

/** One-time migration from the old single-conversation key (STORAGE_KEY)
 * into the new list, so upgrading doesn't silently lose someone's history.
 * Idempotent: safe to call on every listConversations(). */
function migrateLegacyHistoryIfNeeded(): void {
  try {
    if (window.localStorage.getItem(CONVERSATIONS_KEY)) return; // already migrated
    const legacy = loadHistory();
    if (!legacy || legacy.length === 0) return; // nothing to migrate
    const migrated: Conversation = {
      id: crypto.randomUUID(),
      title: deriveTitle(legacy),
      messages: legacy,
      updatedAt: Date.now(),
    };
    writeConversationsRaw([migrated]);
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort -- if migration fails, worst case is starting fresh
  }
}

export function listConversations(): Conversation[] {
  migrateLegacyHistoryIfNeeded();
  return readConversationsRaw().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadConversation(id: string): Conversation | null {
  return readConversationsRaw().find((c) => c.id === id) ?? null;
}

export function saveConversation(id: string, messages: PersistedMessage[]): void {
  if (messages.length === 0) return; // don't persist empty conversations
  const trimmedMessages = messages.slice(-MAX_PERSISTED_MESSAGES);
  const existing = readConversationsRaw();
  const idx = existing.findIndex((c) => c.id === id);
  const entry: Conversation = {
    id,
    title: deriveTitle(trimmedMessages),
    messages: trimmedMessages,
    updatedAt: Date.now(),
  };
  if (idx >= 0) existing[idx] = entry;
  else existing.push(entry);
  writeConversationsRaw(existing);
}

export function deleteConversation(id: string): void {
  writeConversationsRaw(readConversationsRaw().filter((c) => c.id !== id));
}

export function createConversationId(): string {
  return crypto.randomUUID();
}

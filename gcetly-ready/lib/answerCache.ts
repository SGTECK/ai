/**
 * Short-TTL cache for completed chat answers (P0).
 * Keyed by normalized question only (not full history) for FAQ-style repeats.
 */

import type { SourceRef } from "./types";

export interface CachedAnswer {
  text: string;
  sources: SourceRef[];
  confidence?: string;
  topScore?: number;
  at: number;
}

const store = new Map<string, CachedAnswer>();
const TTL_MS = Number(process.env.ANSWER_CACHE_TTL_MS ?? 120_000);
const MAX = 100;

function keyOf(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500);
}

export function getCachedAnswer(message: string): CachedAnswer | null {
  const k = keyOf(message);
  const hit = store.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(k);
    return null;
  }
  return hit;
}

export function setCachedAnswer(
  message: string,
  payload: Omit<CachedAnswer, "at">
): void {
  if (store.size >= MAX) {
    const first = store.keys().next().value;
    if (first !== undefined) store.delete(first);
  }
  store.set(keyOf(message), { ...payload, at: Date.now() });
}

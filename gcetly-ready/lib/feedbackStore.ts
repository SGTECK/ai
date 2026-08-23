/**
 * Feedback storage with swappable backends.
 *
 * Priority:
 * 1. Upstash Redis — if env vars set (multi-instance / serverless)
 * 2. SQLite       — default for self-hosted (data/gcetly.db)
 * 3. JSONL file   — legacy fallback if SQLite cannot open
 */

import { promises as fs } from "fs";
import path from "path";
import {
  getDb,
  sqliteSaveFeedback,
  sqliteLoadFeedback,
  sqliteFeedbackCount,
  type SqliteFeedbackRow,
} from "./db";

export interface FeedbackEntry {
  timestamp: string;
  rating: "up" | "down";
  question: string;
  answer: string;
  sessionId?: string;
}

const LOG_DIR = path.join(process.cwd(), "data", "feedback");
const LOG_FILE = path.join(LOG_DIR, "feedback-log.jsonl");
const UPSTASH_KEY = "gcetly-feedback";
const MAX_STORED_ENTRIES = 2000;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashConfigured = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function upstashCommand(command: (string | number)[]): Promise<any> {
  const res = await fetch(UPSTASH_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Upstash command failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

export type FeedbackBackend = "upstash" | "sqlite" | "local-file";

let resolvedBackend: FeedbackBackend | null = null;

function resolveBackend(): FeedbackBackend {
  if (resolvedBackend) return resolvedBackend;
  if (upstashConfigured) {
    resolvedBackend = "upstash";
    return resolvedBackend;
  }
  try {
    getDb();
    resolvedBackend = "sqlite";
  } catch {
    resolvedBackend = "local-file";
  }
  return resolvedBackend;
}

export function feedbackBackendName(): FeedbackBackend {
  return resolveBackend();
}

export async function saveFeedback(
  entry: FeedbackEntry
): Promise<{ ok: boolean; error?: string }> {
  const backend = resolveBackend();

  if (backend === "upstash") {
    try {
      await upstashCommand(["RPUSH", UPSTASH_KEY, JSON.stringify(entry)]);
      await upstashCommand(["LTRIM", UPSTASH_KEY, -MAX_STORED_ENTRIES, -1]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (backend === "sqlite") {
    try {
      const row: SqliteFeedbackRow = {
        timestamp: entry.timestamp,
        rating: entry.rating,
        question: entry.question,
        answer: entry.answer,
        sessionId: entry.sessionId,
      };
      sqliteSaveFeedback(row);
      return { ok: true };
    } catch (err) {
      // Fall through to JSONL
      console.warn(
        "[feedbackStore] SQLite save failed, trying JSONL:",
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadFeedback(limit = 500): Promise<FeedbackEntry[]> {
  const backend = resolveBackend();

  if (backend === "upstash") {
    try {
      const raw: string[] =
        (await upstashCommand(["LRANGE", UPSTASH_KEY, -limit, -1])) ?? [];
      return raw
        .map((line) => {
          try {
            return JSON.parse(line) as FeedbackEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is FeedbackEntry => e !== null)
        .reverse();
    } catch {
      return [];
    }
  }

  if (backend === "sqlite") {
    try {
      return sqliteLoadFeedback(limit);
    } catch (err) {
      console.warn(
        "[feedbackStore] SQLite load failed, trying JSONL:",
        err instanceof Error ? err.message : err
      );
    }
  }

  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as FeedbackEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is FeedbackEntry => e !== null)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

/** Optional stats helper for admin/health. */
export function feedbackStats(): { total: number; up: number; down: number } | null {
  if (resolveBackend() !== "sqlite") return null;
  try {
    return sqliteFeedbackCount();
  } catch {
    return null;
  }
}

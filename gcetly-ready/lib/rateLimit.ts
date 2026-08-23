/**
 * Fixed-window rate limiter with swappable backends.
 *
 * Priority:
 * 1. Upstash Redis — if UPSTASH_REDIS_REST_URL + TOKEN are set (multi-instance)
 * 2. SQLite       — default for self-hosted (survives restarts, single machine)
 * 3. In-memory    — last-resort fallback if SQLite cannot open
 */

import {
  sqliteCheckRateLimit,
  sqliteCleanupRateLimits,
  getDb,
} from "./db";

const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

// --- In-memory fallback ----------------------------------------------------

const buckets = new Map<string, { count: number; windowStart: number }>();

function checkRateLimitMemory(key: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: LIMIT - 1 };
  }
  if (bucket.count >= LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  bucket.count += 1;
  return { allowed: true, remaining: LIMIT - bucket.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > WINDOW_MS * 5) buckets.delete(key);
  }
}, WINDOW_MS * 5).unref?.();

// Periodic SQLite cleanup
setInterval(() => {
  try {
    sqliteCleanupRateLimits(WINDOW_MS);
  } catch {
    /* ignore */
  }
}, WINDOW_MS * 10).unref?.();

// --- Upstash Redis backend -------------------------------------------------

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashConfigured = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

async function upstashCommand(...command: (string | number)[]): Promise<any> {
  const res = await fetch(`${UPSTASH_URL}/${command.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Upstash command failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

async function checkRateLimitUpstash(key: string): Promise<RateLimitResult> {
  try {
    const redisKey = `gcetly-ratelimit:${key}`;
    const count = await upstashCommand("INCR", redisKey);
    if (count === 1) {
      await upstashCommand("EXPIRE", redisKey, Math.ceil(WINDOW_MS / 1000));
    }
    if (count > LIMIT) return { allowed: false, remaining: 0 };
    return { allowed: true, remaining: Math.max(0, LIMIT - count) };
  } catch (err) {
    console.warn(
      "Rate limit check via Upstash failed, allowing request through:",
      err instanceof Error ? err.message : err
    );
    return { allowed: true, remaining: LIMIT };
  }
}

// --- SQLite backend --------------------------------------------------------

function checkRateLimitSqlite(key: string): RateLimitResult {
  return sqliteCheckRateLimit(key, LIMIT, WINDOW_MS);
}

// --- Public API ------------------------------------------------------------

export type RateLimitBackend = "upstash" | "sqlite" | "memory";

let resolvedBackend: RateLimitBackend | null = null;

function resolveBackend(): RateLimitBackend {
  if (resolvedBackend) return resolvedBackend;
  if (upstashConfigured) {
    resolvedBackend = "upstash";
    return resolvedBackend;
  }
  try {
    getDb(); // open / create schema
    resolvedBackend = "sqlite";
  } catch (err) {
    console.warn(
      "[rateLimit] SQLite unavailable, falling back to in-memory:",
      err instanceof Error ? err.message : err
    );
    resolvedBackend = "memory";
  }
  return resolvedBackend;
}

export function rateLimitBackendName(): RateLimitBackend {
  return resolveBackend();
}

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const backend = resolveBackend();
  if (backend === "upstash") return checkRateLimitUpstash(key);
  if (backend === "sqlite") {
    try {
      return checkRateLimitSqlite(key);
    } catch (err) {
      console.warn(
        "[rateLimit] SQLite check failed, using memory:",
        err instanceof Error ? err.message : err
      );
      return checkRateLimitMemory(key);
    }
  }
  return checkRateLimitMemory(key);
}

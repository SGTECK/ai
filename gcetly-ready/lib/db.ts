/**
 * SQLite persistence layer using Node's built-in `node:sqlite` (DatabaseSync).
 * No native addon / better-sqlite3 required — works on Node 22.5+ / 24+.
 *
 * Used for:
 * - Rate limiting (survives process restarts)
 * - Feedback log (replaces fragile JSONL on self-hosted)
 * - Optional web-search response cache
 *
 * Path: data/gcetly.db (gitignored). Create-on-first-use.
 *
 * Backend priority elsewhere:
 *   Upstash (if env set) → SQLite (this module) → memory/file fallback
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "gcetly.db");

let db: DatabaseSync | null = null;
let initTried = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Lazy open + schema migrate. Safe to call many times. */
export function getDb(): DatabaseSync {
  if (db) return db;
  if (initTried && !db) {
    throw new Error("SQLite previously failed to open");
  }
  initTried = true;
  ensureDataDir();

  const instance = new DatabaseSync(DB_PATH);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA foreign_keys = ON;");

  instance.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      session_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp DESC);

    CREATE TABLE IF NOT EXISTS search_cache (
      query_key TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT,
      source_url TEXT,
      document_type TEXT,
      department TEXT,
      academic_year TEXT,
      authority TEXT DEFAULT 'unknown',
      verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending','verified','rejected','outdated','archived')),
      content_hash TEXT,
      file_path TEXT,
      analysis_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      page_number INTEGER,
      section TEXT,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(verification_status);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
      content,
      document_id UNINDEXED,
      chunk_id UNINDEXED,
      title UNINDEXED,
      tokenize = 'porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      session_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_ts ON analytics_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_embeddings_doc ON chunk_embeddings(document_id);
  `);

  db = instance;
  return instance;
}

export function getDbPath(): string {
  return DB_PATH;
}

/** Best-effort close (mainly for scripts/tests). */
export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
    initTried = false;
  }
}

// ---------------------------------------------------------------------------
// Rate limit helpers
// ---------------------------------------------------------------------------

export function sqliteCheckRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number } {
  const database = getDb();
  const now = Date.now();

  const row = database
    .prepare("SELECT count, window_start FROM rate_limits WHERE key = ?")
    .get(key) as { count: number; window_start: number } | undefined;

  if (!row || now - row.window_start > windowMs) {
    database
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`
      )
      .run(key, now);
    return { allowed: true, remaining: limit - 1 };
  }

  if (row.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  database
    .prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?")
    .run(key);
  return { allowed: true, remaining: Math.max(0, limit - (row.count + 1)) };
}

/** Drop old rate-limit windows (call occasionally). */
export function sqliteCleanupRateLimits(windowMs: number) {
  try {
    const cutoff = Date.now() - windowMs * 5;
    getDb().prepare("DELETE FROM rate_limits WHERE window_start < ?").run(cutoff);
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------

export interface SqliteFeedbackRow {
  timestamp: string;
  rating: "up" | "down";
  question: string;
  answer: string;
  sessionId?: string;
}

export function sqliteSaveFeedback(entry: SqliteFeedbackRow): void {
  getDb()
    .prepare(
      `INSERT INTO feedback (timestamp, rating, question, answer, session_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      entry.timestamp,
      entry.rating,
      entry.question,
      entry.answer,
      entry.sessionId ?? null
    );
}

export function sqliteLoadFeedback(limit = 500): SqliteFeedbackRow[] {
  const rows = getDb()
    .prepare(
      `SELECT timestamp, rating, question, answer, session_id
       FROM feedback
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
    timestamp: string;
    rating: string;
    question: string;
    answer: string;
    session_id: string | null;
  }>;

  return rows.map((r) => ({
    timestamp: r.timestamp,
    rating: r.rating as "up" | "down",
    question: r.question,
    answer: r.answer,
    sessionId: r.session_id ?? undefined,
  }));
}

export function sqliteFeedbackCount(): { total: number; up: number; down: number } {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END) as up,
         SUM(CASE WHEN rating = 'down' THEN 1 ELSE 0 END) as down
       FROM feedback`
    )
    .get() as { total: number; up: number; down: number };
  return {
    total: Number(row.total) || 0,
    up: Number(row.up) || 0,
    down: Number(row.down) || 0,
  };
}

// ---------------------------------------------------------------------------
// Search cache helpers
// ---------------------------------------------------------------------------

export function sqliteGetSearchCache(queryKey: string): string | null {
  const now = Date.now();
  const row = getDb()
    .prepare(
      `SELECT response_json, expires_at FROM search_cache WHERE query_key = ?`
    )
    .get(queryKey) as { response_json: string; expires_at: number } | undefined;

  if (!row) return null;
  if (row.expires_at < now) {
    getDb().prepare("DELETE FROM search_cache WHERE query_key = ?").run(queryKey);
    return null;
  }
  return row.response_json;
}

export function sqliteSetSearchCache(
  queryKey: string,
  responseJson: string,
  ttlMs: number
): void {
  const expires = Date.now() + ttlMs;
  getDb()
    .prepare(
      `INSERT INTO search_cache (query_key, response_json, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(query_key) DO UPDATE SET
         response_json = excluded.response_json,
         expires_at = excluded.expires_at`
    )
    .run(queryKey, responseJson, expires);
}

export function sqliteCleanupSearchCache(): void {
  try {
    getDb().prepare("DELETE FROM search_cache WHERE expires_at < ?").run(Date.now());
  } catch {
    /* non-fatal */
  }
}

export function sqliteSearchCacheSize(): number {
  try {
    const row = getDb()
      .prepare("SELECT COUNT(*) as c FROM search_cache WHERE expires_at >= ?")
      .get(Date.now()) as { c: number };
    return Number(row.c) || 0;
  } catch {
    return 0;
  }
}

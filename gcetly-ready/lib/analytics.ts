import { getDb } from "./db";

export function trackEvent(
  kind: string,
  detail?: string,
  sessionId?: string
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO analytics_events (ts, kind, detail, session_id) VALUES (?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        kind.slice(0, 64),
        (detail || "").slice(0, 500),
        sessionId?.slice(0, 64) || null
      );
  } catch {
    /* ignore */
  }
}

export function analyticsSummary(limit = 50): {
  totals: Record<string, number>;
  recent: Array<{ ts: string; kind: string; detail: string | null }>;
} {
  const totals: Record<string, number> = {};
  let recent: Array<{ ts: string; kind: string; detail: string | null }> = [];
  try {
    const rows = getDb()
      .prepare(
        `SELECT kind, COUNT(*) as n FROM analytics_events GROUP BY kind`
      )
      .all() as Array<{ kind: string; n: number }>;
    for (const r of rows) totals[r.kind] = r.n;
    recent = getDb()
      .prepare(
        `SELECT ts, kind, detail FROM analytics_events ORDER BY id DESC LIMIT ?`
      )
      .all(limit) as Array<{ ts: string; kind: string; detail: string | null }>;
  } catch {
    /* empty */
  }
  return { totals, recent };
}

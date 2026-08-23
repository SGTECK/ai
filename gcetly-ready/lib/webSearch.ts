/**
 * Optional live web search layer.
 *
 * Providers (in order):
 * 1. Brave Search API — when BRAVE_API_KEY is set (recommended)
 * 2. DuckDuckGo HTML (no key) — lightweight fallback
 *
 * In-memory cache (TTL) avoids burning quota on repeated questions.
 * Search is only called when the chat route decides it is needed.
 */

import type { SourceRef } from "./types";
import {
  sqliteGetSearchCache,
  sqliteSetSearchCache,
  sqliteCleanupSearchCache,
} from "./db";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  provider: "brave" | "duckduckgo" | "none" | "cache";
  error?: string;
  cached?: boolean;
}

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || "";
const MAX_RESULTS = 5;
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS ?? 4000);
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_ENTRIES = 200;
/** Max live (non-cache) searches per rolling minute process-wide. */
const SEARCH_RATE_LIMIT_PER_MINUTE = Number(process.env.SEARCH_RATE_LIMIT_PER_MINUTE ?? 10);

const searchHits: number[] = [];
function allowSearchRequest(): boolean {
  const now = Date.now();
  while (searchHits.length && now - searchHits[0] > 60_000) searchHits.shift();
  if (searchHits.length >= SEARCH_RATE_LIMIT_PER_MINUTE) return false;
  searchHits.push(now);
  return true;
}

/** Domains we prefer / trust more for college-related answers. */
const PREFERRED_DOMAINS = [
  "gcetly.ac.in",
  "annauniv.edu",
  "aicte-india.org",
  "tneaonline.org",
  "tn.gov.in",
  "india.gov.in",
  "ugc.gov.in",
  "nbaind.org",
  "doeacc.edu.in",
];

// --- Cache: memory (hot) + SQLite (survives restarts) ---------------------

interface CacheEntry {
  expires: number;
  response: WebSearchResponse;
}

const searchCache = new Map<string, CacheEntry>();

function cacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
}

function getCached(query: string): WebSearchResponse | null {
  const key = cacheKey(query);

  // 1. Hot memory
  const entry = searchCache.get(key);
  if (entry) {
    if (Date.now() > entry.expires) {
      searchCache.delete(key);
    } else {
      return { ...entry.response, provider: "cache", cached: true };
    }
  }

  // 2. SQLite (persistent across restarts)
  try {
    const json = sqliteGetSearchCache(key);
    if (json) {
      const parsed = JSON.parse(json) as WebSearchResponse;
      // Promote back into memory
      searchCache.set(key, {
        expires: Date.now() + CACHE_TTL_MS,
        response: parsed,
      });
      return { ...parsed, provider: "cache", cached: true };
    }
  } catch {
    /* SQLite optional */
  }

  return null;
}

function setCache(query: string, response: WebSearchResponse) {
  if (response.results.length === 0) return;
  const key = cacheKey(query);
  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    const first = searchCache.keys().next().value;
    if (first) searchCache.delete(first);
  }
  const toStore = { ...response, cached: false };
  searchCache.set(key, {
    expires: Date.now() + CACHE_TTL_MS,
    response: toStore,
  });
  try {
    sqliteSetSearchCache(key, JSON.stringify(toStore), CACHE_TTL_MS);
  } catch {
    /* non-fatal */
  }
}

// Occasional cleanup of expired SQLite cache rows
setInterval(() => {
  try {
    sqliteCleanupSearchCache();
  } catch {
    /* ignore */
  }
}, 15 * 60 * 1000).unref?.();

function scoreResult(r: WebSearchResult): number {
  let score = 0;
  const host = (() => {
    try {
      return new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  if (PREFERRED_DOMAINS.some((d) => host === d || host.endsWith("." + d))) {
    score += 10;
  }
  if (host.includes("gcetly")) score += 5;
  if (r.title.length < 80) score += 1;
  return score;
}

function rankResults(results: WebSearchResult[]): WebSearchResult[] {
  return [...results].sort((a, b) => scoreResult(b) - scoreResult(a));
}

// --- Brave ----------------------------------------------------------------

async function searchBrave(query: string): Promise<WebSearchResponse> {
  if (!BRAVE_API_KEY) {
    return { results: [], provider: "none", error: "BRAVE_API_KEY not set" };
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("country", "IN");
  url.searchParams.set("search_lang", "en");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return {
        results: [],
        provider: "brave",
        error: `Brave API returned ${res.status}`,
      };
    }

    const data = await res.json();
    const raw = Array.isArray(data.web?.results) ? data.web.results : [];

    const results: WebSearchResult[] = rankResults(
      raw
        .slice(0, MAX_RESULTS)
        .map((item: any) => ({
          title: String(item.title || "").slice(0, 200),
          url: String(item.url || ""),
          snippet: String(item.description || item.extra_snippets?.[0] || "").slice(0, 400),
        }))
        .filter((r: WebSearchResult) => r.url.startsWith("http"))
    );

    return { results, provider: "brave" };
  } catch (err) {
    return {
      results: [],
      provider: "brave",
      error: err instanceof Error ? err.message : "Brave search failed",
    };
  }
}

// --- DuckDuckGo HTML fallback (no API key) --------------------------------

async function searchDuckDuckGo(query: string): Promise<WebSearchResponse> {
  try {
    // html.duckduckgo.com is the non-JS version; results are in simple anchors
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "GCETLY-AI-Assistant/3.3 (college information bot; +https://gcetly.ac.in)",
      },
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!res.ok) {
      return {
        results: [],
        provider: "duckduckgo",
        error: `DuckDuckGo returned ${res.status}`,
      };
    }

    const html = await res.text();
    const results: WebSearchResult[] = [];

    // Very lightweight extraction — avoid heavy HTML parser dependency here
    // Match result blocks: uddg links + nearby text
    const linkRe =
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe =
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/gi;

    const links: { url: string; title: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null && links.length < MAX_RESULTS * 2) {
      let href = m[1];
      // DuckDuckGo wraps redirects: //duckduckgo.com/l/?uddg=...
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]);
        } catch {
          /* keep original */
        }
      }
      if (!href.startsWith("http")) continue;
      const title = m[2].replace(/<[^>]+>/g, "").trim();
      if (title) links.push({ url: href, title: title.slice(0, 200) });
    }

    const snippets: string[] = [];
    while ((m = snippetRe.exec(html)) !== null && snippets.length < MAX_RESULTS * 2) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").trim().slice(0, 400));
    }

    for (let i = 0; i < Math.min(links.length, MAX_RESULTS); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
      });
    }

    return { results: rankResults(results), provider: "duckduckgo" };
  } catch (err) {
    return {
      results: [],
      provider: "duckduckgo",
      error: err instanceof Error ? err.message : "DuckDuckGo search failed",
    };
  }
}

// --- Public API -----------------------------------------------------------

/**
 * Run a live web search with cache + provider fallback.
 * Order: cache → Brave (if key) → DuckDuckGo.
 */

/** P0: in-memory web search cache (reduce repeated DDG/Brave latency). */
export async function liveWebSearch(
  query: string,
  _options?: { signal?: AbortSignal }
): Promise<WebSearchResponse> {
  const cleaned = query.trim().slice(0, 300);
  if (!cleaned) {
    return { results: [], provider: "none", error: "Empty query" };
  }

  const cached = getCached(cleaned);
  if (cached) return cached;

  if (!allowSearchRequest()) {
    return {
      results: [],
      provider: "none",
      error: "Search rate limit reached — try again in a minute",
    };
  }

  // Prefer Brave when configured
  if (BRAVE_API_KEY) {
    const brave = await searchBrave(cleaned);
    if (brave.results.length > 0) {
      setCache(cleaned, brave);
      return brave;
    }
    // Fall through to DuckDuckGo if Brave returned nothing / errored
  }

  const ddg = await searchDuckDuckGo(cleaned);
  if (ddg.results.length > 0) {
    setCache(cleaned, ddg);
  }
  return ddg;
}

export function webResultsToSources(results: WebSearchResult[]): SourceRef[] {
  return results.map((r) => ({
    url: r.url,
    title: r.title || undefined,
  }));
}

export function formatWebResultsForPrompt(results: WebSearchResult[]): string {
  if (results.length === 0) return "";

  const lines = results.map((r, i) => {
    return `[Web ${i + 1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`;
  });

  return (
    "LIVE WEB SEARCH RESULTS (retrieved just now — treat as additional CONTEXT, " +
    "prefer official college/government domains when they conflict with random sites):\n\n" +
    lines.join("\n\n")
  );
}

/** True when at least one search path can run (Brave key or DDG fallback). */
export function isWebSearchConfigured(): boolean {
  // DuckDuckGo is always available as fallback, so search is always "configured"
  // from a capability standpoint. Callers can still check provider in the response.
  return true;
}

export function getSearchCacheStats(): { size: number; ttlMinutes: number } {
  return { size: searchCache.size, ttlMinutes: CACHE_TTL_MS / 60000 };
}

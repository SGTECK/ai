import type { ChatMessage, FAQEntry, KnowledgeEntry, RetrievedItem } from "./types";
import { getFAQs, getKnowledgeBase } from "./knowledgeStore";
import { listVerifiedChunks } from "./documentProcess";
import { getDb } from "./db";

// Tamil unicode block included so Tamil queries tokenize correctly.
const WORD_RE = /[\w\u0B80-\u0BFF]+/gu;

const STOPWORDS = new Set([
  "the", "is", "a", "an", "of", "to", "in", "for", "and", "or", "on", "at",
  "what", "how", "who", "when", "which", "are", "do", "does", "i",
  "can", "you", "me", "my", "please", "tell", "about", "will", "it", "this",
  "that", "with", "be", "there", "number", "from", "by", "as", "if",
  "was", "were", "been", "being", "have", "has", "had", "did", "done",
  // Common Tamil function words that add little signal
  "என்ன", "எப்படி", "எங்கே", "யார்", "எப்போது", "இருக்கிறது", "உள்ளது",
]);
// NOTE: "where" is deliberately NOT stopped -- stripping it caused exactly
// the bug seen in an earlier iteration of this project: "where is the
// college" degraded to just the token "college", which is so common across
// nearly every document that it fails to discriminate CONTACT out from
// everything else. Keeping "where" lets it co-match FAQ variations that
// legitimately contain it (e.g. "where is gce tirunelveli").
// "number" IS stopped: it appears incidentally across phone/account/room
// numbers throughout the corpus and was causing nonsense queries like
// "lottery number" to retrieve unrelated FEES/HOSTEL content. Domain
// signal for those questions comes from the other token ("phone", "seat",
// "room"), not from "number" itself.

/** Lightweight synonym / abbreviation expansion for common college terms.
 * Applied only to the query (not the corpus) so we don't bloat the IDF table.
 * Keeps retrieval simple while improving recall for short or informal questions. */
const QUERY_EXPANSIONS: Record<string, string[]> = {
  hostel: ["hostels", "mess", "boarding"],
  hostels: ["hostel", "mess"],
  fees: ["fee", "tuition", "charges"],
  fee: ["fees", "tuition"],
  hod: ["head", "department"],
  ece: ["electronics", "communication"],
  cse: ["computer", "science"],
  mech: ["mechanical"],
  civil: ["civil"],
  eee: ["electrical", "electronics"],
  be: ["b.e", "bachelor"],
  me: ["m.e", "master"],
  tnea: ["anna", "university", "counselling"],
  admission: ["admissions", "join", "apply"],
  admissions: ["admission", "join", "apply"],
  scholarship: ["scholarships", "freeship"],
  scholarships: ["scholarship", "freeship"],
  placement: ["placements", "job", "campus"],
  placements: ["placement", "job", "campus"],
  // do not expand principal→head (collides with HOD FAQs)
  principal: ["principal"],
  wifi: ["wi-fi"],
  "wi-fi": ["wifi"],
};

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(WORD_RE) || [];
  const base = matches.filter((w) => w.length > 1 && !STOPWORDS.has(w));
  // Expand query terms only (caller decides whether to expand)
  return base;
}

function expandQueryTokens(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const t of tokens) {
    const extras = QUERY_EXPANSIONS[t];
    if (extras) extras.forEach((e) => out.add(e));
  }
  return Array.from(out);
}

// --- BM25 corpus (FAQ + knowledge). Dependency-free ranking appropriate for
// a college-sized knowledge base. Cached until invalidateRetrievalCache().
//
// BM25 (Okapi): for each query term t
//   score += IDF(t) * (tf * (k1+1)) / (tf + k1 * (1 - b + b * |d|/avgdl))
// IDF uses the Lucene/Okapi form: log(1 + (N - df + 0.5) / (df + 0.5))

/** BM25 term-frequency saturation */
const BM25_K1 = Number(process.env.BM25_K1 ?? 1.2);
/** BM25 document-length normalization (0=none, 1=full) */
const BM25_B = Number(process.env.BM25_B ?? 0.75);

interface CorpusDoc {
  id: string;
  kind: "faq" | "knowledge" | "document";
  /** Unique terms (for quick membership checks / title logic) */
  tokens: Set<string>;
  /** Term frequency map for BM25 */
  tf: Map<string, number>;
  /** Token count |d| */
  length: number;
  /** FAQ: BM25 over question+variations only (avoids answer-body polluting rank) */
  questionTf?: Map<string, number>;
  questionLength?: number;
  ref: FAQEntry | KnowledgeEntry;
}

interface CorpusIndex {
  docs: CorpusDoc[];
  /** BM25 IDF per term */
  idf: Map<string, number>;
  avgdl: number;
}

let corpusIndexCache: CorpusIndex | null = null;

function termFrequencies(text: string): { tf: Map<string, number>; length: number; tokens: Set<string> } {
  const raw = tokenize(text);
  const tf = new Map<string, number>();
  for (const t of raw) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  return { tf, length: raw.length, tokens: new Set(raw) };
}

function buildCorpusIndex(): CorpusIndex {
  const faqs = getFAQs();
  const kb = getKnowledgeBase();
  const docs: CorpusDoc[] = [];

  for (const f of faqs) {
    const text = [f.question, ...f.variations, f.answer].join(" ");
    const { tf, length, tokens } = termFrequencies(text);
    const qOnly = termFrequencies([f.question, ...f.variations].join(" "));
    docs.push({
      id: f.id,
      kind: "faq",
      tokens,
      tf,
      length,
      questionTf: qOnly.tf,
      questionLength: qOnly.length,
      ref: f,
    });
  }
  for (const k of kb) {
    const text = [k.pageTitle, k.content].join(" ");
    const { tf, length, tokens } = termFrequencies(text);
    docs.push({ id: k.id, kind: "knowledge", tokens, tf, length, ref: k });
  }
  // Admin-approved document chunks (P3 pipeline)
  try {
    for (const ch of listVerifiedChunks()) {
      const text = [ch.title, ch.content].join(" ");
      const { tf, length, tokens } = termFrequencies(text);
      docs.push({
        id: ch.id,
        kind: "document",
        tokens,
        tf,
        length,
        ref: {
          id: ch.id,
          sourceUrl: ch.source_url || `document:${ch.document_id}`,
          pageTitle: ch.title,
          category: "GENERAL_INFORMATION",
          content: ch.content,
          lastChecked: new Date().toISOString().slice(0, 10),
          sourceType: "official_pdf",
          priority: 1,
        } as KnowledgeEntry,
      });
    }
  } catch {
    /* SQLite optional at build time */
  }

  const N = Math.max(docs.length, 1);
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const doc of docs) {
    totalLen += doc.length;
    for (const term of doc.tokens) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  const avgdl = totalLen / N;

  const idf = new Map<string, number>();
  for (const [term, n] of df.entries()) {
    // Okapi BM25 IDF (smooth, non-negative for common terms)
    idf.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }

  return { docs, idf, avgdl };
}

function getCorpus(): CorpusIndex {
  if (!corpusIndexCache) {
    corpusIndexCache = buildCorpusIndex();
  }
  return corpusIndexCache;
}

/** Call after re-running the crawler/ingestion so the next request rebuilds
 * the corpus instead of serving a stale cache. */
export function invalidateRetrievalCache() {
  corpusIndexCache = null;
  retrievalResultCache.clear();
}

/** Short-TTL cache for identical retrieval queries (P0 latency). */
const retrievalResultCache = new Map<string, { at: number; result: RetrievalResult }>();
const RETRIEVAL_CACHE_TTL_MS = Number(process.env.RETRIEVAL_CACHE_TTL_MS ?? 60_000);
const RETRIEVAL_CACHE_MAX = 200;

function retrievalCacheKey(message: string, history: ChatMessage[], topK: number): string {
  const last = [...history].reverse().find((m) => m.role === "user");
  return `${topK}::${message.trim().toLowerCase()}::${(last?.content || "").trim().toLowerCase().slice(0, 120)}`;
}


/**
 * Pure BM25 score for one document (no domain boosts).
 * Exported for unit tests / eval harness.
 */
export function bm25Score(
  queryTokens: string[],
  doc: { tf: Map<string, number>; length: number },
  idf: Map<string, number>,
  avgdl: number,
  k1 = BM25_K1,
  b = BM25_B
): number {
  if (queryTokens.length === 0 || doc.length === 0) return 0;
  let score = 0;
  const seen = new Set<string>();
  for (const t of queryTokens) {
    if (seen.has(t)) continue; // count each query term once (query TF=1)
    seen.add(t);
    const f = doc.tf.get(t) || 0;
    if (f === 0) continue;
    const idfT = idf.get(t) ?? 0;
    const denom = f + k1 * (1 - b + b * (doc.length / Math.max(avgdl, 1)));
    score += idfT * ((f * (k1 + 1)) / denom);
  }
  return score;
}

/**
 * Full ranking score: BM25 + title/phrase/coverage + official priority.
 */
function scoreDoc(
  queryTokens: string[],
  doc: CorpusDoc,
  idf: Map<string, number>,
  avgdl: number,
  rawQueryLower: string
): number {
  let score: number;
  if (doc.kind === "faq" && doc.questionTf && doc.questionLength) {
    const qScore = bm25Score(
      queryTokens,
      { tf: doc.questionTf, length: doc.questionLength },
      idf,
      avgdl
    );
    const bodyScore = bm25Score(queryTokens, doc, idf, avgdl);
    // Question match dominates; answer body is only a light tie-breaker
    score = qScore * 2.2 + bodyScore * 0.2;
  } else {
    score = bm25Score(queryTokens, doc, idf, avgdl);
  }
  if (score <= 0) return 0;

  let matched = 0;
  for (const t of queryTokens) {
    if (doc.tokens.has(t)) matched += 1;
  }
  const coverage = matched / Math.max(new Set(queryTokens).size, 1);
  score *= 0.85 + 0.3 * coverage;

  let titleText = "";
  if (doc.kind === "faq") {
    titleText = (doc.ref as FAQEntry).question.toLowerCase();
  } else {
    titleText = (doc.ref as KnowledgeEntry).pageTitle.toLowerCase();
  }
  const titleTokens = tokenize(titleText);
  let titleHits = 0;
  for (const t of new Set(queryTokens)) {
    if (titleTokens.includes(t)) titleHits += 1;
  }
  if (titleHits > 0) {
    // Strong title/question match beats long body TF (e.g. ECE FAQ mentioning "principal")
    score *= 1 + Math.min(0.85, titleHits * 0.35);
  } else if (doc.kind === "faq") {
    // FAQ body-only match is weaker than a real question match
    score *= 0.5;
  }

  if (rawQueryLower.length >= 6) {
    const blob =
      doc.kind === "faq"
        ? `${(doc.ref as FAQEntry).question} ${(doc.ref as FAQEntry).answer}`.toLowerCase()
        : `${(doc.ref as KnowledgeEntry).pageTitle} ${(doc.ref as KnowledgeEntry).content}`.toLowerCase();
    const words = rawQueryLower.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 2) {
      const bigram = `${words[0]} ${words[1]}`;
      if (blob.includes(bigram)) score *= 1.12;
    }
  }

  const priority =
    doc.kind === "knowledge" || doc.kind === "document"
      ? (doc.ref as KnowledgeEntry).priority
      : 1;
  let weighted = score * priorityWeight(priority);
  if (doc.kind === "faq") weighted *= 1.04;
  // P1: slight boost for fresher knowledge entries
  weighted *= freshnessBoost(doc);
  return weighted;
}

function freshnessBoost(doc: CorpusDoc): number {
  try {
    let dateStr = "";
    if (doc.kind === "faq") dateStr = (doc.ref as FAQEntry).lastVerified || "";
    else dateStr = (doc.ref as KnowledgeEntry).lastChecked || "";
    if (!dateStr) return 1;
    const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
    if (Number.isNaN(ageDays) || ageDays < 0) return 1;
    if (ageDays < 30) return 1.08;
    if (ageDays < 90) return 1.04;
    if (ageDays < 365) return 1.0;
    return 0.95;
  } catch {
    return 1;
  }
}

/** Extracted as its own exported, pure function specifically so the
 * multi-site trust-tier weighting can be unit-tested directly (see
 * tests/test-crawler.ts "PRIORITY WEIGHTING") rather than only indirectly
 * through a full retrieve() call. Priority 1 = official gcetly.ac.in /
 * government portal tier, 4 = least-trusted external site. */
export function priorityWeight(priority: 1 | 2 | 3 | 4): number {
  return { 1: 1.15, 2: 1.05, 3: 0.95, 4: 0.85 }[priority] ?? 1;
}

/** Builds the text used for retrieval: the current message plus a little of
 * the immediately preceding turn, so short follow-ups ("how many seats?")
 * inherit context ("...about ECE") from within THIS conversation only.
 * History comes entirely from the client-held state -- nothing here reads
 * from any server-side store, which is what keeps sessions isolated.
 * Short messages (< 4 tokens) get extra history weight so follow-ups work better. */
function buildRetrievalQuery(message: string, history: ChatMessage[]): string {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const msgTokens = tokenize(message);
  const isShort = msgTokens.length > 0 && msgTokens.length < 4;
  const parts = isShort ? [message, message, message] : [message, message]; // heavier weight for short follow-ups
  if (lastUser && lastUser.content !== message) {
    parts.push(lastUser.content);
    if (isShort) parts.push(lastUser.content); // double history for very short queries
  }
  return parts.join(" ");
}

export interface RetrievalResult {
  items: RetrievedItem[];
  topScore: number;
}


/** Optional FTS5 hit set for admin document chunks (hybrid sparse boost). */
function ftsMatchingChunkIds(query: string): Set<string> {
  const ids = new Set<string>();
  const q = query.replace(/[^a-zA-Z0-9\u0B80-\u0BFF\s]/g, " ").trim();
  if (q.length < 3) return ids;
  try {
    const terms = q.split(/\s+/).filter((t) => t.length > 2).slice(0, 6);
    if (!terms.length) return ids;
    // FTS5 MATCH query — quote terms simply
    const match = terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const rows = getDb()
      .prepare(
        `SELECT chunk_id FROM document_chunks_fts WHERE document_chunks_fts MATCH ? LIMIT 40`
      )
      .all(match) as { chunk_id: string }[];
    for (const r of rows) if (r.chunk_id) ids.add(r.chunk_id);
  } catch {
    /* fts unavailable */
  }
  return ids;
}

export function retrieve(message: string, history: ChatMessage[], topK = 6): RetrievalResult {
  const cacheKey = retrievalCacheKey(message, history, topK);
  const hit = retrievalResultCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RETRIEVAL_CACHE_TTL_MS) {
    return hit.result;
  }

  const { docs, idf, avgdl } = getCorpus();
  const lastUser = [...history].reverse().find((m) => m.role === "user");

  const rawMsgTokens = tokenize(message);
  const msgTokens = expandQueryTokens(rawMsgTokens);
  const rawMsgLower = message.toLowerCase();

  const rawHistTokens = lastUser && lastUser.content !== message ? tokenize(lastUser.content) : [];
  const histTokens = expandQueryTokens(rawHistTokens);
  const rawHistLower = lastUser ? lastUser.content.toLowerCase() : "";

  if (msgTokens.length === 0 && histTokens.length === 0) {
    return { items: [], topScore: 0 };
  }

  // FREE_MODE: slightly fewer chunks → faster prompt, still grounded
  const free = process.env.FREE_MODE === "1" || process.env.FREE_MODE === "true";
  const k = free ? Math.min(topK, 4) : topK;

  const ftsHits = ftsMatchingChunkIds(message);

  let scored = docs.map((doc) => {
    const msgScore = msgTokens.length > 0 ? scoreDoc(msgTokens, doc, idf, avgdl, rawMsgLower) : 0;
    const histScore = histTokens.length > 0 ? scoreDoc(histTokens, doc, idf, avgdl, rawHistLower) : 0;

    let score = 0;
    if (msgScore > 0) {
      // Document matches the user's current message terms directly.
      // History provides a moderate tie-breaking boost if relevant (e.g. "how many seats?" with history "ECE").
      score = msgScore + histScore * 0.25;
    }
    if (score > 0 && ftsHits.has(doc.id)) score *= 1.15;
    return { doc, score };
  });

  // If NO document matched the current message's tokens (e.g. follow-up query like "tell me more" or purely conversational):
  // fallback to scoring with history context
  const hasMsgMatches = scored.some((s) => s.score > 0);
  if (!hasMsgMatches && histTokens.length > 0) {
    scored = docs.map((doc) => {
      const histScore = scoreDoc(histTokens, doc, idf, avgdl, rawHistLower);
      const score = histScore * 0.8;
      return { doc, score };
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score > 0).slice(0, k);

  const items: RetrievedItem[] = top.map(({ doc, score }) => {
    if (doc.kind === "faq") {
      const f = doc.ref as FAQEntry;
      return { text: `Q: ${f.question}\nA: ${f.answer}`, source: f.source, title: f.question, category: f.category, lastChecked: f.lastVerified, score, kind: "faq" };
    }
    const k = doc.ref as KnowledgeEntry;
    return { text: k.content, source: k.sourceUrl, title: k.pageTitle, category: k.category, lastChecked: k.lastChecked, score, kind: doc.kind === "document" ? "knowledge" : "knowledge" };
  });

  const result: RetrievalResult = { items, topScore: top[0]?.score ?? 0 };
  if (retrievalResultCache.size >= RETRIEVAL_CACHE_MAX) {
    const first = retrievalResultCache.keys().next().value;
    if (first !== undefined) retrievalResultCache.delete(first);
  }
  retrievalResultCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

// ---------------------------------------------------------------------------
// Intent detection -- keeps small-talk from hitting the strict "couldn't
// verify" grounding gate (this was the bug visible in the canvas-chatbot
// screenshot: "Hi" returned the knowledge-base fallback instead of a
// greeting). Greetings/thanks/farewells get a friendly response instead of
// being routed through retrieval at all.
// ---------------------------------------------------------------------------
const GREETING_RE = /^h(i+|ello+|ey+|ai)\b|^(good\s?(morning|afternoon|evening))\b|^vanakkam\b|^வணக்கம்/i;
const THANKS_RE = /^(thanks|thank\s?you|thankyou|thx)\b|^நன்றி/i;
const FAREWELL_RE = /^(bye|goodbye|see\s?you|good\s?night)\.?$/i;
const ACK_RE = /^(ok(ay)?|great|cool|nice|got it|alright)\.?$/i;

export type SmallTalkKind = "greeting" | "thanks" | "farewell" | "ack" | null;

export function classifySmallTalk(message: string): SmallTalkKind {
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.split(/\s+/).length > 4) return null;
  if (GREETING_RE.test(trimmed)) return "greeting";
  if (THANKS_RE.test(trimmed)) return "thanks";
  if (FAREWELL_RE.test(trimmed)) return "farewell";
  if (ACK_RE.test(trimmed)) return "ack";
  return null;
}

export function isGreetingOrSmallTalk(message: string): boolean {
  return classifySmallTalk(message) !== null;
}

// Signals that the answer may depend on live/current information rather
// than the static knowledge base -- triggers the optional web_search tool.
const CURRENT_INFO_PATTERNS = [
  /\blatest\b/i, /\bcurrent(ly)?\b/i, /\brecent(ly)?\b/i, /\btoday\b/i,
  /\bright now\b/i, /\bupdate[sd]?\b/i, /\bnotification[s]?\b/i,
  /\bnotice[s]?\b/i, /\bdeadline\b/i, /\blast date\b/i, /\bupcoming\b/i,
  /\bthis year\b/i, /\b2026\b/, /\b2027\b/,
  /\bnews\b/i, /\bwhat('s| is) happening\b/i,
  /\bwho is the (principal|hod|head)\b/i, /\bwho is\b.*\b(principal|hod)\b/i,
];

export function needsCurrentInfo(message: string): boolean {
  return CURRENT_INFO_PATTERNS.some((re) => re.test(message));
}

// Explicit "Deep Research Mode" trigger phrases -- when matched, the caller
// should force web search on regardless of other heuristics AND ask for
// the structured Answer/Key Information/Verification/Sources format
// instead of the normal concise-by-default style (see systemPrompt.ts).
const DEEP_RESEARCH_PATTERNS = [
  /\bdeep research\b/i, /\bresearch this\b/i, /\bsearch the web\b/i,
  /\bfind all information\b/i, /\bcheck google\b/i, /\bcheck social media\b/i,
  /\bverify this\b/i, /\bsearch (the )?entire web\b/i,
];

export function isDeepResearchRequest(message: string): boolean {
  return DEEP_RESEARCH_PATTERNS.some((re) => re.test(message));
}

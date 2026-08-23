// Shared types for the knowledge base, FAQ dataset, chat messages, and API contracts.

export type Category =
  | "ADMISSIONS"
  | "ACADEMICS"
  | "DEPARTMENTS"
  | "HOSTEL"
  | "FEES"
  | "EXAMINATIONS"
  | "SCHOLARSHIPS"
  | "PLACEMENTS"
  | "FACILITIES"
  | "RESEARCH"
  | "STUDENT_ACTIVITIES"
  | "CONTACT"
  | "NOTIFICATIONS"
  | "GENERAL_INFORMATION";

export type SourceType = "official_website" | "official_pdf" | "government_portal" | "external_website";

/** Shared between client (character counter/instant feedback) and server
 * (actual enforcement) so there's one source of truth. Previously the
 * server silently truncated anything over this with `.slice()` -- which
 * meant a genuinely long question got quietly cut mid-sentence and
 * answered as if that's what was asked, with no indication to the user
 * that anything was cut. Now enforced as an explicit rejection instead. */
export const MAX_MESSAGE_LENGTH = 2000;

/** One retrievable chunk of verified knowledge. */
export interface KnowledgeEntry {
  id: string;
  sourceUrl: string;
  pageTitle: string;
  category: Category;
  content: string;
  lastChecked: string; // ISO date
  sourceType: SourceType;
  priority: 1 | 2 | 3 | 4; // 1 = official gcetly.ac.in, per the spec's source hierarchy
  documentDate?: string; // when the underlying notice/document itself is dated, if known
}

/** A curated FAQ entry, with alternate phrasings that should resolve to the same answer. */
export interface FAQEntry {
  id: string;
  question: string;
  variations: string[];
  answer: string;
  category: Category;
  source: string;
  lastVerified: string; // ISO date
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface RetrievedItem {
  text: string;
  source: string;
  /** Human-readable page title (from KnowledgeEntry.pageTitle) or the FAQ
   * question -- used to show a real document title in citations (Phase 6:
   * "display the PDF/document title where possible") instead of just a
   * bare URL. */
  title: string;
  category: Category;
  lastChecked: string;
  score: number;
  kind: "faq" | "knowledge";
}

/** Confidence band derived from retrieval topScore. Used both server-side
 * (to decide whether to short-circuit to the fallback) and client-side
 * (to show a small badge so users know how well the answer was grounded). */
export type ConfidenceLevel = "high" | "medium" | "low" | "none";

/** Thresholds tuned for the current TF-IDF + priority weighting.
 * Adjust after measuring real query distributions. */
export const CONFIDENCE_THRESHOLDS = {
  high: 3.5,
  medium: 1.8,
  low: 0.6,
} as const;

export function scoreToConfidence(topScore: number): ConfidenceLevel {
  if (topScore >= CONFIDENCE_THRESHOLDS.high) return "high";
  if (topScore >= CONFIDENCE_THRESHOLDS.medium) return "medium";
  if (topScore >= CONFIDENCE_THRESHOLDS.low) return "low";
  return "none";
}

export type Language = "en" | "ta" | "mixed";

/** A citation shown in the UI. `title` is optional -- local knowledge-base
 * sources and FAQ entries always have one (page title / question text);
 * live web_search results sometimes don't return a title, in which case
 * the UI falls back to showing the URL alone. */
export interface SourceRef {
  url: string;
  title?: string;
}

/** Extended done payload so the client can show a confidence badge. */
export interface ChatDonePayload {
  sources: SourceRef[];
  language: string;
  followUps: string[];
  confidence?: ConfidenceLevel;
  topScore?: number;
}

export interface ChatRequestBody {
  message: string;
  history: ChatMessage[]; // held client-side only; the server never persists this
  sessionId: string; // client-generated, used only for rate limiting -- never for memory
  preferredLanguage?: Language | "auto";
}

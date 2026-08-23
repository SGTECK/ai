import type { Category } from "./types";

/**
 * v2.0 feature: suggested next questions shown after an answer, in the
 * style of a modern AI assistant. Deliberately rule-based (a static map
 * from category -> real, KB-adjacent questions) rather than a second live
 * Claude call -- no extra latency, no extra API cost, and since every
 * suggestion is just a rephrasing of ground the KB already covers, this
 * feature can never itself introduce a hallucinated claim; the worst case
 * is the same honest "couldn't verify" fallback as any other question.
 */
const FOLLOW_UPS_BY_CATEGORY: Record<Category, string[]> = {
  ADMISSIONS: ["What documents are required?", "What is the fee structure?", "What is hostel life like?"],
  ACADEMICS: ["What is the academic calendar?", "How do examinations work?", "What departments are available?"],
  DEPARTMENTS: ["What are the placement statistics?", "Tell me about the faculty.", "What labs are available?"],
  HOSTEL: ["What is the mess timing?", "How much does hostel cost?", "What is the admission process?"],
  FEES: ["Are scholarships available?", "What is the hostel fee?", "What is the admission process?"],
  EXAMINATIONS: ["What is the academic calendar?", "What are the examination regulations?", "How can I contact the exam cell?"],
  SCHOLARSHIPS: ["What is the fee structure?", "What is the admission process?", "Who do I contact about scholarships?"],
  PLACEMENTS: ["Which departments have the best placements?", "Tell me about research activities.", "What facilities are available?"],
  FACILITIES: ["Tell me about the library.", "What about hostel facilities?", "Tell me about research activities."],
  RESEARCH: ["Tell me about placements.", "What departments are available?", "What facilities support research?"],
  STUDENT_ACTIVITIES: ["What facilities are available?", "Tell me about placements.", "What departments are available?"],
  CONTACT: ["What is the admission process?", "Where is the college located?", "What are the college's facilities?"],
  NOTIFICATIONS: ["What is the admission process?", "What is the academic calendar?", "How can I contact the college?"],
  GENERAL_INFORMATION: ["What is the admission process?", "Tell me about the departments.", "What are the placement statistics?"],
};

const FALLBACK_FOLLOW_UPS = ["What is the admission process?", "Tell me about hostel facilities.", "What departments are available?"];

/** Loose "already basically asked this" check -- avoids suggesting the
 * exact question (or a trivial rephrasing of it) the person just asked. */
function isTooSimilar(candidate: string, asked: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const c = norm(candidate);
  const a = norm(asked);
  if (c === a) return true;
  const cWords = new Set(c.split(/\s+/).filter((w) => w.length > 3));
  const aWords = new Set(a.split(/\s+/).filter((w) => w.length > 3));
  if (cWords.size === 0) return false;
  let overlap = 0;
  cWords.forEach((w) => { if (aWords.has(w)) overlap++; });
  return overlap / cWords.size >= 0.6;
}

export function getFollowUps(topCategory: Category | undefined, askedQuestion: string, max = 3): string[] {
  const pool = (topCategory ? FOLLOW_UPS_BY_CATEGORY[topCategory] : undefined) ?? FALLBACK_FOLLOW_UPS;
  return pool.filter((q) => !isTooSimilar(q, askedQuestion)).slice(0, max);
}

/**
 * Query router (P0/P1) — decide LOCAL vs WEB vs GENERAL before spending latency.
 *
 * LOCAL_ONLY      → BM25 + LLM only (fastest)
 * LOCAL_PLUS_WEB  → BM25 first, web if still weak or explicitly current
 * WEB_REQUIRED    → force web (latest notices, deep research)
 * GENERAL_KNOWLEDGE → not college-specific; model may answer generally
 */

import { needsCurrentInfo, isDeepResearchRequest } from "./retrieval";

export type QueryRoute =
  | "LOCAL_ONLY"
  | "LOCAL_PLUS_WEB"
  | "WEB_REQUIRED"
  | "GENERAL_KNOWLEDGE";

const COLLEGE_HINT =
  /\b(gce|gcetly|tirunelveli|hostel|tnea|anna\s*university|admission|department|ece|cse|mech|civil|placement|scholarship|fee|transfer|lateral|nss|dress\s*code|uniform|attire|b\.e|m\.e|principal|hod|campus)\b/i;

const EXPANDED_COLLEGE_HINT =
  /\b(gce|gcetly|tirunelveli|hostel|hostels|tnea|anna\s*university|admission|admissions|department|departments|ece|cse|mech|civil|eee|eie|placement|placements|scholarship|scholarships|fee|fees|transfer|lateral|nss|dress\s*code|uniform|attire|b\.e|m\.e|principal|hod|campus|wifi|password|menu|cutoff|cutoffs|quota|salary|exam\s*paper|question\s*paper|internal\s*marks|attendance|canteen|mess|bus|library|hall\s*ticket|revaluation|lab|credits?|semester|dota|dote|guidelines|prospectus|circular|notification|helpline|helpdesk)\b/i;

export function isCollegeSpecificQuery(message: string): boolean {
  return EXPANDED_COLLEGE_HINT.test(message);
}

const GENERAL_HINT =
  /\b(kirchhoff|newton|photosynthesis|python programming|what is ai|capital of|who invented)\b/i;

export function routeQuery(
  message: string,
  opts: { topScore: number; freeMode?: boolean }
): QueryRoute {
  const q = message.trim();
  if (!q) return "LOCAL_ONLY";

  if (isDeepResearchRequest(q)) return "WEB_REQUIRED";

  if (GENERAL_HINT.test(q) && !COLLEGE_HINT.test(q)) {
    return "GENERAL_KNOWLEDGE";
  }

  // Strong local hit → never pay for web
  if (opts.topScore >= 12) return "LOCAL_ONLY";

  if (needsCurrentInfo(q)) {
    return opts.topScore >= 6 ? "LOCAL_PLUS_WEB" : "WEB_REQUIRED";
  }

  if (COLLEGE_HINT.test(q)) {
    return opts.topScore >= 6 ? "LOCAL_ONLY" : "LOCAL_PLUS_WEB";
  }

  // Unknown questions should get a web chance when local knowledge is absent.
  if (opts.freeMode) return "LOCAL_PLUS_WEB";
  return opts.topScore > 0 ? "LOCAL_ONLY" : "LOCAL_PLUS_WEB";
}

export function shouldRunWebSearch(route: QueryRoute): boolean {
  return route === "WEB_REQUIRED" || route === "LOCAL_PLUS_WEB";
}

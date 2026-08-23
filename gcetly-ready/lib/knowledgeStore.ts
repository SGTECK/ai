import fs from "node:fs";
import path from "node:path";
import type { FAQEntry, KnowledgeEntry } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

let knowledgeCache: KnowledgeEntry[] | null = null;
let faqCache: FAQEntry[] | null = null;
let knowledgeMtime = 0;
let autoKnowledgeMtime = 0;
let faqMtime = 0;

function readJson<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function readJsonIfExists<T>(filename: string): T | null {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function fileMtime(filename: string): number {
  try {
    return fs.statSync(path.join(DATA_DIR, filename)).mtimeMs;
  } catch {
    return 0;
  }
}

/** Returns the knowledge base: the hand-curated entries in
 * gcetly-knowledge.json PLUS anything scripts/update-knowledge.ts has
 * auto-generated into gcetly-knowledge.auto.json from the latest crawl (if
 * that file exists). Re-reads from disk if either file changed since the
 * last call, so `npm run update-knowledge` takes effect without restarting
 * the dev server. The curated file is never overwritten by the crawler. */
export function getKnowledgeBase(): KnowledgeEntry[] {
  const mtime = fileMtime("gcetly-knowledge.json");
  const autoMtime = fileMtime("gcetly-knowledge.auto.json");
  if (!knowledgeCache || mtime !== knowledgeMtime || autoMtime !== autoKnowledgeMtime) {
    const curated = readJson<KnowledgeEntry[]>("gcetly-knowledge.json");
    const auto = readJsonIfExists<KnowledgeEntry[]>("gcetly-knowledge.auto.json") ?? [];
    knowledgeCache = [...curated, ...auto];
    knowledgeMtime = mtime;
    autoKnowledgeMtime = autoMtime;
  }
  return knowledgeCache;
}

export function getFAQs(): FAQEntry[] {
  const mtime = fileMtime("gcetly-faq.json");
  if (!faqCache || mtime !== faqMtime) {
    faqCache = readJson<FAQEntry[]>("gcetly-faq.json");
    faqMtime = mtime;
  }
  return faqCache;
}

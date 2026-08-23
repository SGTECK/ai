/**
 * Reads everything scripts/crawl-gcetly.ts stored in data/crawled/pages/,
 * categorizes and chunks it, and writes data/gcetly-knowledge.auto.json --
 * per spec section 23's "update-knowledge" script.
 *
 * This file is fully regenerated on each run (safe to overwrite, since it's
 * a mechanical derivation of the raw crawl). It is loaded ALONGSIDE the
 * hand-curated data/gcetly-knowledge.json at request time (see
 * lib/knowledgeStore.ts) -- this script never touches the curated file, so
 * your manually-verified entries are never clobbered by a re-crawl.
 *
 * Usage:
 *   npm run update-knowledge
 *   npm run update-knowledge -- --dir data/crawled
 *
 * Note on "embeddings/index entries" (spec section 23, point 7): this
 * project uses a lightweight local TF-IDF-style keyword retriever (see
 * lib/retrieval.ts) rather than a vector database, which the project spec
 * explicitly permits ("a suitable vector database OR lightweight local
 * retrieval architecture"). There is no separate embedding step to run --
 * the retriever tokenizes this file's `content` field at request time.
 */
import fs from "node:fs";
import path from "node:path";
import type { Category, KnowledgeEntry, SourceType } from "../lib/types";

interface CrawledPageRecord {
  url: string;
  title: string;
  text: string;
  crawledAt: number;
  contentHash: string;
  fetchMethod: string;
  // Present on pages crawled with the multi-site crawler. Older crawl
  // output (pre multi-site) won't have these -- see FALLBACK below.
  sourceType?: SourceType;
  priority?: 1 | 2 | 3 | 4;
  siteLabel?: string;
}

// Fallback trust tier for crawl records saved before multi-site support was
// added (no sourceType/priority/siteLabel on disk). Assumes gcetly.ac.in
// since that was the only domain the crawler could ever produce before.
const FALLBACK_SOURCE_TYPE: SourceType = "official_website";
const FALLBACK_PRIORITY: 1 | 2 | 3 | 4 = 1;
const FALLBACK_LABEL = "GCE-TLY Official Website";

// --- Best-effort category inference from URL path + title keywords. -------
// Mechanical, not perfect -- skim data/gcetly-knowledge.auto.json after
// running this, especially for FEES/EXAMINATIONS/NOTIFICATIONS where dates
// and figures matter most.
const CATEGORY_RULES: Array<{ category: Category; patterns: RegExp[] }> = [
  { category: "ADMISSIONS", patterns: [/admission/i, /tnea/i, /prospectus/i] },
  { category: "FEES", patterns: [/fee/i, /refund/i] },
  { category: "SCHOLARSHIPS", patterns: [/scholarship/i] },
  { category: "HOSTEL", patterns: [/hostel/i] },
  { category: "EXAMINATIONS", patterns: [/exam/i, /calendar/i, /regulation/i] },
  { category: "PLACEMENTS", patterns: [/placement/i, /training/i, /internship/i] },
  { category: "RESEARCH", patterns: [/research/i, /innovat/i, /patent/i] },
  { category: "STUDENT_ACTIVITIES", patterns: [/nss/i, /ncc/i, /sport/i, /club/i, /association/i] },
  { category: "CONTACT", patterns: [/contact/i, /help.?desk/i] },
  { category: "NOTIFICATIONS", patterns: [/notic/i, /circular/i, /announcement/i, /news/i] },
  {
    category: "DEPARTMENTS",
    patterns: [/dept/i, /department/i, /\b(ece|cse|eee|mech|civil|ei|biotech)\b/i, /staff/i, /faculty/i],
  },
  { category: "ACADEMICS", patterns: [/academic/i, /program/i, /course/i, /syllabus/i, /curriculum/i] },
  { category: "FACILITIES", patterns: [/facilit/i, /library/i, /canteen/i, /bank/i, /atm/i] },
];

function inferCategory(url: string, title: string): Category {
  const haystack = `${url} ${title}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(haystack))) return rule.category;
  }
  return "GENERAL_INFORMATION";
}

// --- Chunking: split on blank lines first, then hard-wrap anything still
// too long, targeting ~900 characters per chunk with light overlap context
// carried via the page title on every chunk. -------------------------------
const TARGET_CHUNK_SIZE = 900;

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > TARGET_CHUNK_SIZE && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
    while (current.length > TARGET_CHUNK_SIZE * 1.5) {
      chunks.push(current.slice(0, TARGET_CHUNK_SIZE).trim());
      current = current.slice(TARGET_CHUNK_SIZE);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.trim()].filter(Boolean);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let dir = "data/crawled";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") dir = argv[++i];
  }
  return { dir };
}

function main() {
  const { dir } = parseArgs();
  const pagesDir = path.resolve(process.cwd(), dir, "pages");
  const outputPath = path.resolve(process.cwd(), "data", "gcetly-knowledge.auto.json");

  if (!fs.existsSync(pagesDir)) {
    console.error(`No crawled pages found at ${pagesDir}. Run "npm run crawl" first.`);
    process.exit(1);
  }

  const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.warn(`${pagesDir} is empty -- nothing to convert. Run "npm run crawl" first.`);
    fs.writeFileSync(outputPath, "[]\n", "utf-8");
    return;
  }

  const entries: KnowledgeEntry[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const file of files) {
    const record: CrawledPageRecord = JSON.parse(fs.readFileSync(path.join(pagesDir, file), "utf-8"));
    if (!record.text || record.text.trim().length === 0) continue;

    const category = inferCategory(record.url, record.title);
    const chunks = chunkText(record.text);
    const sourceType = record.sourceType ?? FALLBACK_SOURCE_TYPE;
    const priority = record.priority ?? FALLBACK_PRIORITY;
    const siteLabel = record.siteLabel ?? FALLBACK_LABEL;

    chunks.forEach((chunk, i) => {
      entries.push({
        id: `auto-${path.basename(file, ".json")}-${i}`,
        sourceUrl: record.url,
        pageTitle: record.title ? `${record.title} (${siteLabel})` : record.url,
        category,
        content: chunk,
        lastChecked: new Date(record.crawledAt).toISOString().slice(0, 10) || today,
        sourceType,
        priority,
      });
    });
  }

  fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2), "utf-8");

  const byCategory: Record<string, number> = {};
  for (const e of entries) byCategory[e.category] = (byCategory[e.category] || 0) + 1;

  console.log(`Wrote ${entries.length} auto-generated knowledge entries from ${files.length} crawled pages.`);
  console.log("By category:", byCategory);
  console.log(`\nOutput: ${outputPath}`);
  console.log("This supplements (does not replace) the hand-curated data/gcetly-knowledge.json.");
  console.log("Spot-check the auto file, especially FEES/EXAMINATIONS/NOTIFICATIONS entries, before trusting them fully.");
}

main();

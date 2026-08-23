/**
 * Crawls one or more websites, staying on-domain per site, respecting each
 * site's robots.txt, and storing raw + cleaned content with source URL,
 * site label, trust tier, and crawl timestamp -- per project spec section 23.
 * Downloads linked PDFs alongside pages.
 *
 * Single site (original behavior, unchanged if you pass nothing):
 *   npm run crawl                                    -- crawls gcetly.ac.in, up to 150 pages total
 *   npm run crawl -- --max-pages 60
 *   npm run crawl -- --seed https://gcetly.ac.in/hostel.php
 *   npm run crawl -- --force                          -- ignore incremental cache, re-store everything
 *
 * Multiple sites: add one --site flag per extra site. Format is
 * pipe-separated: domain|seedUrl|sourceType|priority|label
 *   sourceType is one of: official_website | official_pdf | government_portal | external_website
 *   priority is 1 (most trusted) to 4 (least) -- matches the spec's source hierarchy.
 *
 *   npm run crawl -- \
 *     --site "gcetly.ac.in|https://gcetly.ac.in|official_website|1|GCE-TLY Official Website" \
 *     --site "annauniv.edu|https://www.annauniv.edu|government_portal|1|Anna University" \
 *     --site "aicte-india.org|https://www.aicte-india.org|government_portal|2|AICTE" \
 *     --max-pages 300
 *
 * If you use --site at all, the plain gcetly.ac.in default is NOT added
 * automatically -- include it explicitly as one of your --site entries if
 * you still want it crawled in the same run.
 *
 * This does NOT touch data/gcetly-knowledge.json directly -- run
 * `npm run update-knowledge` afterward to regenerate the structured,
 * categorized knowledge base from what was just crawled.
 */
import type { SourceType } from "../lib/types";
import {
  CrawlStore,
  DEFAULT_SITE,
  RECOMMENDED_SITES,
  downloadPdf,
  extractContent,
  fetchPage,
  isAllowed,
  loadDisallowedPaths,
  REQUEST_DELAY_MS,
  SiteConfig,
  sleep,
  THIN_CONTENT_THRESHOLD,
} from "./crawlerCore";

interface Args {
  sites: SiteConfig[];
  extraSeeds: string[]; // --seed URLs, matched against an existing --site's domain if possible, else DEFAULT_SITE's domain
  maxPages: number;
  force: boolean;
  outputDir: string;
}

const VALID_SOURCE_TYPES: SourceType[] = ["official_website", "official_pdf", "government_portal", "external_website"];

function parseSiteFlag(raw: string): SiteConfig {
  const parts = raw.split("|").map((p) => p.trim());
  const [domain, seedUrl, sourceType, priorityStr, label] = parts;
  if (!domain || !seedUrl) {
    throw new Error(`--site value must be "domain|seedUrl|sourceType|priority|label", got: ${raw}`);
  }
  const resolvedType = VALID_SOURCE_TYPES.includes(sourceType as SourceType) ? (sourceType as SourceType) : "external_website";
  const priority = ([1, 2, 3, 4].includes(Number(priorityStr)) ? Number(priorityStr) : 3) as 1 | 2 | 3 | 4;
  return { domain, seedUrl, sourceType: resolvedType, priority, label: label || domain };
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const sites: SiteConfig[] = [];
  const extraSeeds: string[] = [];
  let maxPages = 150;
  let force = false;
  let outputDir = "data/crawled";
  let withRecommended = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--site") sites.push(parseSiteFlag(argv[++i]));
    else if (argv[i] === "--seed") extraSeeds.push(argv[++i]);
    else if (argv[i] === "--max-pages") maxPages = parseInt(argv[++i], 10);
    else if (argv[i] === "--force") force = true;
    else if (argv[i] === "--output") outputDir = argv[++i];
    else if (argv[i] === "--with-recommended-sites") withRecommended = true;
  }

  if (withRecommended) {
    // Merge recommended list; explicit --site entries override by domain
    const byDomain = new Map<string, SiteConfig>();
    for (const s of RECOMMENDED_SITES) byDomain.set(s.domain, s);
    for (const s of sites) byDomain.set(s.domain, s);
    return {
      sites: Array.from(byDomain.values()),
      extraSeeds,
      maxPages: Math.max(maxPages, 250),
      force,
      outputDir,
    };
  }

  if (sites.length === 0) sites.push(DEFAULT_SITE);
  return { sites, extraSeeds, maxPages, force, outputDir };
}

/** Matches a plain --seed URL to the SiteConfig whose domain it belongs to,
 * so its pages get the right trust tier/label. Falls back to treating it as
 * a same-tier extra seed for the first configured site if no domain matches. */
function siteForUrl(url: string, sites: SiteConfig[]): SiteConfig {
  const hostname = new URL(url).hostname;
  return sites.find((s) => hostname.includes(s.domain)) ?? sites[0];
}

async function main() {
  const { sites, extraSeeds, maxPages, force, outputDir } = parseArgs();
  const store = new CrawlStore(outputDir);
  const allowedDomains = sites.map((s) => s.domain);

  const disallowedByOrigin = new Map<string, string[]>();
  for (const site of sites) {
    const origin = new URL(site.seedUrl).origin;
    disallowedByOrigin.set(origin, await loadDisallowedPaths(origin));
  }

  const queue: string[] = [...sites.map((s) => s.seedUrl), ...extraSeeds];
  const visited = new Set<string>();
  let pagesSaved = 0;
  let pagesSkipped = 0;
  let pdfsDownloaded = 0;

  console.log(
    `Starting crawl across ${sites.length} site(s): ${sites.map((s) => `${s.label} (${s.domain}, priority ${s.priority})`).join("; ")} (max ${maxPages} pages total)...`
  );

  while (queue.length > 0 && pagesSaved < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const site = siteForUrl(url, sites);
    const origin = new URL(url).origin;
    const disallowed = disallowedByOrigin.get(origin) ?? (await loadDisallowedPaths(origin));
    disallowedByOrigin.set(origin, disallowed);

    if (!isAllowed(url, disallowed)) {
      console.log(`Skipping (robots.txt disallows): ${url}`);
      continue;
    }

    let { html, method } = await fetchPage(url);
    if (!html) {
      console.warn(`No HTML retrieved for ${url}`);
      continue;
    }

    let extracted = extractContent(html, url, allowedDomains);

    if (method === "static" && extracted.text.length < THIN_CONTENT_THRESHOLD) {
      // Thin page -- likely JS-rendered. Playwright fallback is a no-op if not installed.
      const { fetchRendered } = await import("./crawlerCore");
      const renderedHtml = await fetchRendered(url);
      if (renderedHtml) {
        html = renderedHtml;
        method = "rendered";
        extracted = extractContent(html, url, allowedDomains);
      }
    }

    if (!force && !store.hasChanged(url, extracted.text)) {
      pagesSkipped++;
      console.log(`Unchanged, skipping: ${url}`);
    } else {
      store.savePage(url, extracted.title, extracted.text, html, method, site);
      pagesSaved++;
      console.log(`[${pagesSaved}/${maxPages}] Crawled (${method}, ${site.label}): ${url} -- ${extracted.title}`);
    }

    for (const pdfUrl of extracted.pdfLinks) {
      if (!(store.manifest as any)._pdfs?.[pdfUrl]) {
        if (await downloadPdf(pdfUrl, store)) {
          pdfsDownloaded++;
          console.log(`Downloaded PDF: ${pdfUrl}`);
        }
      }
    }

    for (const link of extracted.links) {
      if (!visited.has(link)) queue.push(link);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const summary = store.summary();
  console.log("\n--- Crawl complete ---");
  console.log(`Pages saved this run: ${pagesSaved}`);
  console.log(`Pages skipped (unchanged): ${pagesSkipped}`);
  console.log(`PDFs downloaded this run: ${pdfsDownloaded}`);
  console.log(`Total pages visited: ${visited.size}`);
  console.log(`Total pages in store: ${summary.pages}, total PDFs in store: ${summary.pdfs}`);
  console.log(`Output directory: ${summary.outputDir}`);
  console.log("\nNext step: npm run update-knowledge   (regenerates data/gcetly-knowledge.auto.json from this crawl)");
}

main().catch((err) => {
  console.error("Crawl failed:", err);
  process.exit(1);
});

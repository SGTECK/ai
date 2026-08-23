/**
 * Core crawling utilities shared by scripts/crawl-gcetly.ts. Kept dependency-light:
 * native fetch (Node 18+) for HTTP, `cheerio` for HTML parsing. An optional
 * Playwright fallback handles the rare JS-rendered page (install with
 * `npm i -D playwright && npx playwright install chromium` if you hit one --
 * everything else works without it).
 *
 * Multi-site support: the crawler no longer hardcodes a single allowed
 * domain. Each seed you pass in belongs to a SiteConfig (domain + trust
 * metadata), and links are only followed within the set of domains you
 * explicitly configured -- so pointing this at other websites never turns
 * into an open-ended crawl of the entire internet.
 */
import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SourceType } from "../lib/types";

export const USER_AGENT = "GCETLY-AI-Assistant-Crawler/1.0 (+internal college chatbot; contact: helpdesk@gcetly.ac.in)";
export const REQUEST_DELAY_MS = 1000;
export const THIN_CONTENT_THRESHOLD = 400;

/** One crawlable site: a seed URL plus how content from its domain should
 * be trusted and labeled once it reaches the knowledge base. Priority
 * follows the spec's source hierarchy: 1 = official gcetly.ac.in tier. */
export interface SiteConfig {
  domain: string; // hostname, e.g. "gcetly.ac.in" -- links are matched via hostname.includes(domain)
  seedUrl: string;
  sourceType: SourceType;
  priority: 1 | 2 | 3 | 4;
  label: string; // human-readable, shown in citations, e.g. "Anna University"
}

/** The original single-site default, kept so `npm run crawl` with no flags
 * behaves exactly as before. */
export const DEFAULT_SITE: SiteConfig = {
  domain: "gcetly.ac.in",
  seedUrl: "https://gcetly.ac.in",
  sourceType: "official_website",
  priority: 1,
  label: "GCE-TLY Official Website",
};

/**
 * Recommended extra trusted sites for a fuller knowledge base.
 * Use with: npm run crawl -- --with-recommended-sites
 * or pass each via --site flags.
 */
export const RECOMMENDED_SITES: SiteConfig[] = [
  DEFAULT_SITE,
  {
    domain: "annauniv.edu",
    seedUrl: "https://www.annauniv.edu",
    sourceType: "government_portal",
    priority: 1,
    label: "Anna University",
  },
  {
    domain: "tneaonline.org",
    seedUrl: "https://www.tneaonline.org",
    sourceType: "government_portal",
    priority: 1,
    label: "TNEA Online",
  },
  {
    domain: "aicte-india.org",
    seedUrl: "https://www.aicte-india.org",
    sourceType: "government_portal",
    priority: 2,
    label: "AICTE",
  },
];

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  crawledAt: number;
  contentHash: string;
  fetchMethod: "static" | "rendered";
  // Multi-site metadata -- carried through so update-knowledge.ts doesn't
  // have to re-derive trust level from the URL alone.
  sourceType: SourceType;
  priority: 1 | 2 | 3 | 4;
  siteLabel: string;
}

export interface ExtractResult {
  title: string;
  text: string;
  links: string[];
  pdfLinks: string[];
}

// --- Fetching -----------------------------------------------------------

export async function fetchStatic(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) return null;
    return await res.text();
  } catch (err) {
    console.warn(`Static fetch failed for ${url}:`, (err as Error).message);
    return null;
  }
}

/** Optional JS-render fallback. Dynamically imports Playwright only if
 * installed, so it's never a hard dependency for the common case. */
export async function fetchRendered(url: string): Promise<string | null> {
  try {
    // @ts-ignore -- optional dependency, may not be installed
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: USER_AGENT });
      await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn(
      `Rendered fetch unavailable/failed for ${url} (install Playwright for JS-heavy pages): ${(err as Error).message}`
    );
    return null;
  }
}

export async function fetchPage(url: string): Promise<{ html: string | null; method: "static" | "rendered" }> {
  const html = await fetchStatic(url);
  return html ? { html, method: "static" } : { html: await fetchRendered(url), method: "rendered" };
}

// --- Extraction -----------------------------------------------------------

const BOILERPLATE_TAGS = ["script", "style", "noscript", "nav", "footer", "header", "form", "iframe"];
const BOILERPLATE_LINE_RES = [/^\d{4}-\d{7}.*\|.*@.*$/, /^©\s*\d{4}.*all rights reserved/i, /^privacy policy.*terms of use/i];

/** allowedDomains: only links whose hostname includes one of these are kept
 * for further crawling (or as PDF links). A page can still be extracted
 * even if it links off-domain -- those links are just not queued. */
export function extractContent(html: string, baseUrl: string, allowedDomains: string[]): ExtractResult {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();

  const links = new Set<string>();
  const pdfLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
    let absolute: URL;
    try {
      absolute = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!allowedDomains.some((d) => absolute.hostname.includes(d))) return;
    const clean = absolute.toString().split("#")[0];
    if (clean.toLowerCase().endsWith(".pdf")) pdfLinks.add(clean);
    else links.add(clean);
  });

  BOILERPLATE_TAGS.forEach((tag) => $(tag).remove());

  const rawText = ($("main").length ? $("main") : $("body")).text();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of rawText.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (BOILERPLATE_LINE_RES.some((re) => re.test(line))) continue;
    if (line.length < 40 && seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  return { title, text: lines.join("\n"), links: Array.from(links).sort(), pdfLinks: Array.from(pdfLinks).sort() };
}

// --- robots.txt (minimal parser: User-agent: * block's Disallow rules) ---
// Now per-domain, since a multi-site crawl needs a separate robots.txt read
// (and separate disallow list) for each site.

const robotsCache = new Map<string, string[]>();

export async function loadDisallowedPaths(domainOrigin: string): Promise<string[]> {
  if (robotsCache.has(domainOrigin)) return robotsCache.get(domainOrigin)!;
  try {
    const res = await fetch(`${domainOrigin}/robots.txt`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      robotsCache.set(domainOrigin, []);
      return [];
    }
    const text = await res.text();
    const lines = text.split("\n").map((l) => l.trim());
    const disallowed: string[] = [];
    let inWildcardBlock = false;
    for (const line of lines) {
      if (/^user-agent:\s*\*/i.test(line)) inWildcardBlock = true;
      else if (/^user-agent:/i.test(line)) inWildcardBlock = false;
      else if (inWildcardBlock && /^disallow:/i.test(line)) {
        const p = line.split(":").slice(1).join(":").trim();
        if (p) disallowed.push(p);
      }
    }
    robotsCache.set(domainOrigin, disallowed);
    return disallowed;
  } catch {
    robotsCache.set(domainOrigin, []);
    return [];
  }
}

export function isAllowed(url: string, disallowedPaths: string[]): boolean {
  const path = new URL(url).pathname;
  return !disallowedPaths.some((d) => path.startsWith(d));
}

// --- Storage (raw + cleaned + manifest, incremental via content hash) ---

export class CrawlStore {
  root: string;
  pagesDir: string;
  rawDir: string;
  pdfsDir: string;
  manifestPath: string;
  manifest: Record<string, { contentHash: string; crawledAt: number; pagePath: string; title: string }>;

  constructor(outputDir = "data/crawled") {
    this.root = path.resolve(process.cwd(), outputDir);
    this.pagesDir = path.join(this.root, "pages");
    this.rawDir = path.join(this.root, "raw");
    this.pdfsDir = path.join(this.root, "pdfs");
    for (const d of [this.pagesDir, this.rawDir, this.pdfsDir]) fs.mkdirSync(d, { recursive: true });
    this.manifestPath = path.join(this.root, "manifest.json");
    this.manifest = fs.existsSync(this.manifestPath) ? JSON.parse(fs.readFileSync(this.manifestPath, "utf-8")) : {};
  }

  private saveManifest() {
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  private slugify(url: string): string {
    const u = new URL(url);
    const host = u.hostname.replace(/[^a-zA-Z0-9]+/g, "-");
    const p = u.pathname.replace(/^\/|\/$/g, "") || "index";
    return `${host}--${p.replace(/[^a-zA-Z0-9]+/g, "-")}`.toLowerCase();
  }

  hasChanged(url: string, cleanedText: string): boolean {
    const hash = createHash("sha256").update(cleanedText).digest("hex").slice(0, 16);
    return this.manifest[url]?.contentHash !== hash;
  }

  savePage(
    url: string,
    title: string,
    cleanedText: string,
    rawHtml: string,
    method: "static" | "rendered",
    site: SiteConfig
  ) {
    const slug = this.slugify(url);
    const hash = createHash("sha256").update(cleanedText).digest("hex").slice(0, 16);
    const crawledAt = Date.now();

    fs.writeFileSync(path.join(this.rawDir, `${slug}.html`), rawHtml, "utf-8");

    const record: CrawledPage = {
      url,
      title,
      text: cleanedText,
      crawledAt,
      contentHash: hash,
      fetchMethod: method,
      sourceType: site.sourceType,
      priority: site.priority,
      siteLabel: site.label,
    };
    const pagePath = path.join(this.pagesDir, `${slug}.json`);
    fs.writeFileSync(pagePath, JSON.stringify(record, null, 2), "utf-8");

    this.manifest[url] = { contentHash: hash, crawledAt, pagePath, title };
    this.saveManifest();
  }

  markPdf(url: string, localPath: string) {
    (this.manifest as any)._pdfs = (this.manifest as any)._pdfs || {};
    (this.manifest as any)._pdfs[url] = { localPath, downloadedAt: Date.now() };
    this.saveManifest();
  }

  summary() {
    const pdfCount = Object.keys((this.manifest as any)._pdfs || {}).length;
    const pageCount = Object.keys(this.manifest).filter((k) => k !== "_pdfs").length;
    return { pages: pageCount, pdfs: pdfCount, outputDir: this.root };
  }
}

export async function downloadPdf(url: string, store: CrawlStore): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    const filename = new URL(url).pathname.split("/").pop() || "document.pdf";
    const localPath = path.join(store.pdfsDir, filename);
    fs.writeFileSync(localPath, buf);
    store.markPdf(url, localPath);
    return true;
  } catch (err) {
    console.warn(`Failed to download PDF ${url}:`, (err as Error).message);
    return false;
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

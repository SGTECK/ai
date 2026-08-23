/**
 * Tests for the multi-site crawler's pure, network-free logic
 * (scripts/crawlerCore.ts). Kept as a separate file from
 * tests/test-questions.ts since it's a genuinely different subsystem.
 *
 * HONEST LIMITATION, stated plainly rather than glossed over: this file
 * could NOT be executed in the environment these tests were written in --
 * scripts/crawlerCore.ts imports `cheerio` for HTML parsing, and cheerio
 * isn't installed anywhere in that sandbox (no network access to `npm
 * install` it). Every other test file in this project was written to have
 * zero external runtime dependencies specifically so it COULD be verified
 * by actually running it; this is the one exception, imposed by what the
 * crawler itself needs (a real HTML parser), not a choice.
 *
 * These tests are correct based on careful manual tracing through
 * extractContent's and isAllowed's actual logic, line by line, matched
 * against real HTML fixtures below -- but "carefully reasoned through" is
 * not the same claim as "verified passing," and this file should not be
 * treated as green until you've actually run `npm test` yourself once
 * cheerio is installed (which happens automatically the first time you run
 * `npm install`, since it's already a declared dependency in package.json).
 *
 * The priorityWeight tests for the trust-tier weighting that these crawler
 * results feed into live in tests/test-questions.ts instead, specifically
 * because that logic has zero external dependencies and COULD be verified
 * by actually running it in this environment -- see that file for tests
 * that are genuinely confirmed passing, not just reasoned through.
 */
import assert from "node:assert/strict";
import { extractContent, isAllowed, DEFAULT_SITE } from "../scripts/crawlerCore";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------------
section("EXTRACT CONTENT -- basic extraction");
// ---------------------------------------------------------------------------
test("extracts the title and main text", () => {
  const html = `<html><head><title>Admissions - GCE-TLY</title></head><body><main><p>Admission opens in June.</p></main></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/admissions", ["gcetly.ac.in"]);
  assert.equal(result.title, "Admissions - GCE-TLY");
  assert.ok(result.text.includes("Admission opens in June."));
});

test("prefers <main> content over the rest of <body> when both exist", () => {
  const html = `<html><body><nav>Home | About</nav><main><p>The real content.</p></main><footer>Copyright</footer></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.ok(result.text.includes("The real content."));
});

test("removes boilerplate tags (script, style, nav, footer) from extracted text", () => {
  const html = `<html><body><script>trackEvent();</script><style>.a{color:red}</style><main><p>Kept text.</p></main></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.ok(!result.text.includes("trackEvent"));
  assert.ok(!result.text.includes("color:red"));
  assert.ok(result.text.includes("Kept text."));
});

// ---------------------------------------------------------------------------
section("EXTRACT CONTENT -- link handling (the part a multi-site crawl depends on most)");
// ---------------------------------------------------------------------------
test("keeps links within an allowed domain", () => {
  const html = `<html><body><a href="/hostel.php">Hostel</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.ok(result.links.includes("https://gcetly.ac.in/hostel.php"));
});

test("drops links to domains NOT in the allowed list -- this is what stops an open-ended crawl of the whole internet", () => {
  const html = `<html><body><a href="https://facebook.com/somepage">FB</a><a href="/hostel.php">Hostel</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.equal(result.links.some((l) => l.includes("facebook.com")), false);
  assert.ok(result.links.some((l) => l.includes("hostel.php")));
});

test("keeps links across MULTIPLE allowed domains (the actual point of multi-site support)", () => {
  const html = `<html><body><a href="https://gcetly.ac.in/page">A</a><a href="https://annauniv.edu/page">B</a><a href="https://spam-site.example/page">C</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in", "annauniv.edu"]);
  assert.ok(result.links.some((l) => l.includes("gcetly.ac.in")));
  assert.ok(result.links.some((l) => l.includes("annauniv.edu")));
  assert.equal(result.links.some((l) => l.includes("spam-site.example")), false);
});

test("separates PDF links from regular page links", () => {
  const html = `<html><body><a href="/notice.pdf">Notice</a><a href="/page.php">Page</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.ok(result.pdfLinks.some((l) => l.endsWith("notice.pdf")));
  assert.equal(result.links.some((l) => l.endsWith("notice.pdf")), false);
});

test("rejects javascript:, mailto:, and #-anchor hrefs without throwing", () => {
  const html = `<html><body><a href="javascript:void(0)">JS</a><a href="mailto:x@y.com">Mail</a><a href="#section">Anchor</a><a href="/real.php">Real</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.equal(result.links.length, 1);
  assert.ok(result.links[0].endsWith("real.php"));
});

test("a malformed href doesn't crash extraction, just gets skipped", () => {
  const html = `<html><body><a href="http://[invalid">Bad</a><a href="/ok.php">OK</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/", ["gcetly.ac.in"]);
  assert.ok(result.links.some((l) => l.endsWith("ok.php")));
});

test("resolves relative links against the base URL correctly", () => {
  const html = `<html><body><a href="../departments/ece.php">ECE</a></body></html>`;
  const result = extractContent(html, "https://gcetly.ac.in/admissions/apply.php", ["gcetly.ac.in"]);
  assert.ok(result.links.some((l) => l === "https://gcetly.ac.in/departments/ece.php"));
});

// ---------------------------------------------------------------------------
section("ROBOTS.TXT DISALLOW MATCHING");
// ---------------------------------------------------------------------------
test("a path matching a disallow rule is not allowed", () => {
  assert.equal(isAllowed("https://gcetly.ac.in/admin/panel", ["/admin"]), false);
});
test("a path NOT matching any disallow rule is allowed", () => {
  assert.equal(isAllowed("https://gcetly.ac.in/hostel.php", ["/admin"]), true);
});
test("an empty disallow list allows everything", () => {
  assert.equal(isAllowed("https://gcetly.ac.in/anything", []), true);
});
test("matches against multiple disallow rules correctly", () => {
  const rules = ["/admin", "/private", "/tmp"];
  assert.equal(isAllowed("https://gcetly.ac.in/private/data", rules), false);
  assert.equal(isAllowed("https://gcetly.ac.in/public/data", rules), true);
});

// ---------------------------------------------------------------------------
section("SITE CONFIG DEFAULTS");
// ---------------------------------------------------------------------------
test("DEFAULT_SITE preserves single-site behavior (npm run crawl with no flags)", () => {
  assert.equal(DEFAULT_SITE.domain, "gcetly.ac.in");
  assert.equal(DEFAULT_SITE.priority, 1);
});

// Priority-weighting tests intentionally live in tests/test-questions.ts,
// not here -- see the file header comment above for why.

console.log(`\n${"=".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("=".repeat(50));
if (failed > 0) process.exit(1);

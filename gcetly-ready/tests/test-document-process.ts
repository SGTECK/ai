/**
 * Unit tests for document chunking / extraction (no SQLite required for pure fns).
 */
import { chunkText, extractTextFromFile } from "../lib/documentProcess";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log("  OK", msg);
  } else {
    failed++;
    console.error("  FAIL", msg);
  }
}

console.log("DOCUMENT PROCESS");

const long = Array.from({ length: 12 }, (_, i) =>
  `Section ${i}: Government College of Engineering Tirunelveli provides detailed guidance on hostel fees, mess rules, academic capacity, and student facilities for official reference and testing of retrieval chunk boundaries with enough length.`
).join("\n\n");
const chunks = chunkText(long);
assert(chunks.length >= 2, `chunkText yields multiple chunks (${chunks.length})`);
assert(chunks.some((c) => /hostel|fees|GCE/i.test(c)), "chunks keep college terms");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcetly-doc-"));
const txt = path.join(dir, "sample.txt");
fs.writeFileSync(txt, "Government College of Engineering Tirunelveli hostel information for testing extraction pipeline quality.");
const extracted = extractTextFromFile(txt);
assert(extracted.text.includes("Tirunelveli"), "txt extract");
assert(extracted.method === "utf8-text", "txt method");

const html = path.join(dir, "sample.html");
fs.writeFileSync(html, "<html><script>bad()</script><body><p>GCE-TLY admissions 2026</p></body></html>");
const htmlEx = extractTextFromFile(html);
assert(htmlEx.text.includes("admissions"), "html extract");
assert(!htmlEx.text.includes("bad()"), "html strips script");

console.log(`\nPassed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);

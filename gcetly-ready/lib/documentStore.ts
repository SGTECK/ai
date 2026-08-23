/**
 * Admin document registry (Phase E skeleton).
 * Upload → analyze → pending → approve → (future: chunk + index).
 * Never auto-publishes to production RAG without verification_status=verified.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db";
import { indexApprovedDocument } from "./documentProcess";
import { invalidateRetrievalCache } from "./retrieval";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export type VerificationStatus =
  | "pending"
  | "verified"
  | "rejected"
  | "outdated"
  | "archived";

export interface DocumentRecord {
  id: string;
  title: string;
  source: string | null;
  source_url: string | null;
  document_type: string | null;
  department: string | null;
  academic_year: string | null;
  authority: string;
  verification_status: VerificationStatus;
  content_hash: string | null;
  file_path: string | null;
  analysis_json: string | null;
  created_at: string;
  updated_at: string;
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXT = new Set([
  ".txt", ".md", ".csv", ".json", ".html", ".htm", ".pdf", ".log",
]);


/** Lightweight heuristic analysis — not a full LLM review. */
export function analyzeDocumentMeta(input: {
  title: string;
  filename: string;
  size: number;
  textPreview?: string;
}): Record<string, unknown> {
  const name = `${input.title} ${input.filename}`.toLowerCase();
  const college =
    /gce|gcetly|tirunelveli/.test(name) ||
    /gce|gcetly|tirunelveli/.test(input.textPreview || "");
  const yearMatch = name.match(/20[2-3][0-9]/);
  return {
    relevance_estimate: college ? 0.9 : 0.4,
    quality_estimate: input.size > 100 && input.size < 20_000_000 ? 0.85 : 0.5,
    duplicate: false,
    academic_year: yearMatch?.[0] ?? null,
    department: /ece|cse|mech|civil|eee/.test(name)
      ? name.match(/ece|cse|mech|civil|eee/)![0].toUpperCase()
      : "General",
    authority: college ? "Official GCE-TLY (estimated)" : "unknown",
    ocr_required: false,
    notes: "Heuristic analysis only — admin must review before approve.",
  };
}

export function listDocuments(status?: VerificationStatus): DocumentRecord[] {
  const database = getDb();
  if (status) {
    return database
      .prepare(
        `SELECT * FROM documents WHERE verification_status = ? ORDER BY created_at DESC LIMIT 200`
      )
      .all(status) as DocumentRecord[];
  }
  return database
    .prepare(`SELECT * FROM documents ORDER BY created_at DESC LIMIT 200`)
    .all() as DocumentRecord[];
}

export function registerPendingDocument(input: {
  title: string;
  filename: string;
  bytes: Buffer;
  source?: string;
  source_url?: string;
}): DocumentRecord {
  ensureUploadDir();
  const ext = path.extname(input.filename).toLowerCase() || ".txt";
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`File type not allowed (${ext}). Use: ${[...ALLOWED_EXT].join(", ")}`);
  }
  if (input.bytes.length === 0) throw new Error("Empty file");
  const id = randomUUID();
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const dest = path.join(UPLOAD_DIR, `${id}_${safeName}`);
  fs.writeFileSync(dest, input.bytes);

  const analysis = analyzeDocumentMeta({
    title: input.title,
    filename: input.filename,
    size: input.bytes.length,
  });
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO documents (
        id, title, source, source_url, document_type, department, academic_year,
        authority, verification_status, content_hash, file_path, analysis_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title,
      input.source ?? null,
      input.source_url ?? null,
      path.extname(input.filename).replace(".", "") || null,
      (analysis.department as string) || null,
      (analysis.academic_year as string) || null,
      (analysis.authority as string) || "unknown",
      hash,
      dest,
      JSON.stringify(analysis),
      now,
      now
    );

  return getDb().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRecord;
}

export async function setDocumentStatus(
  id: string,
  status: VerificationStatus
): Promise<{ doc: DocumentRecord | null; index?: { ok: boolean; chunks: number; method: string; error?: string } }> {
  const now = new Date().toISOString();
  const r = getDb()
    .prepare(
      `UPDATE documents SET verification_status = ?, updated_at = ? WHERE id = ?`
    )
    .run(status, now, id);
  if (r.changes === 0) return { doc: null };
  let index;
  if (status === "verified") {
    index = await indexApprovedDocument(id);
    invalidateRetrievalCache();
  } else {
    // Drop chunks if rejected/archived
    try {
      getDb().prepare(`DELETE FROM document_chunks WHERE document_id = ?`).run(id);
      invalidateRetrievalCache();
    } catch { /* ignore */ }
  }
  const doc = getDb().prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRecord;
  return { doc, index };
}

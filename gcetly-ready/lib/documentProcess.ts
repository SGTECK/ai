/**
 * Advanced document pipeline:
 * extract (txt/html/pdf via pdftotext|strings) → optional OCR (tesseract CLI)
 * → chunk → SQLite → FTS → optional Ollama embeddings
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { getDb } from "./db";
import { upsertChunkEmbedding } from "./vectorStore";

const MAX_CHUNK = 600;
const CHUNK_OVERLAP = 100;

function tryCli(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return typeof out === "string" ? out : String(out);
  } catch {
    return null;
  }
}

export function extractTextFromFile(filePath: string): {
  text: string;
  method: string;
} {
  if (!fs.existsSync(filePath)) {
    return { text: "", method: "missing" };
  }
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  if ([".txt", ".md", ".csv", ".json", ".log"].includes(ext)) {
    return { text: buf.toString("utf8"), method: "utf8-text" };
  }

  if ([".html", ".htm"].includes(ext)) {
    const raw = buf.toString("utf8");
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return { text, method: "html-strip" };
  }

  if (ext === ".pdf") {
    // Prefer poppler pdftotext when installed (best quality, free)
    const pdftotext = tryCli("pdftotext", ["-layout", "-q", filePath, "-"]);
    if (pdftotext && pdftotext.trim().length > 40) {
      return { text: pdftotext.trim(), method: "pdftotext" };
    }
    const asLatin = buf.toString("latin1");
    const matches = asLatin.match(/[\x20-\x7E\n\r\t]{5,}/g) || [];
    const text = matches.join("\n").replace(/\s+/g, " ").trim().slice(0, 250_000);
    if (text.length > 80) return { text, method: "pdf-binary-strings" };

    // OCR fallback: rasterize not available without convert; try tesseract on file if image
    return { text: "", method: "pdf-needs-ocr" };
  }

  if ([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"].includes(ext)) {
    const ocr = tryCli("tesseract", [filePath, "stdout", "-l", "eng+tam"]);
    if (ocr && ocr.trim().length > 20) {
      return { text: ocr.trim(), method: "tesseract-ocr" };
    }
    const ocrEng = tryCli("tesseract", [filePath, "stdout", "-l", "eng"]);
    if (ocrEng && ocrEng.trim().length > 20) {
      return { text: ocrEng.trim(), method: "tesseract-ocr-eng" };
    }
    return { text: "", method: "ocr-unavailable" };
  }

  const text = buf.toString("utf8").replace(/\0/g, "");
  return { text, method: "utf8-fallback" };
}

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";
  const push = (s: string) => {
    const t = s.trim();
    if (t.length >= 40) chunks.push(t);
  };
  for (const p of paragraphs) {
    if ((buf + "\n\n" + p).length <= MAX_CHUNK) {
      buf = buf ? `${buf}\n\n${p}` : p;
      continue;
    }
    if (buf) push(buf);
    if (p.length <= MAX_CHUNK) {
      buf = p;
    } else {
      for (let i = 0; i < p.length; i += MAX_CHUNK - CHUNK_OVERLAP) {
        push(p.slice(i, i + MAX_CHUNK));
      }
      buf = "";
    }
  }
  if (buf) push(buf);
  return chunks;
}

export async function indexApprovedDocument(documentId: string): Promise<{
  ok: boolean;
  chunks: number;
  embedded: number;
  method: string;
  error?: string;
}> {
  try {
    const database = getDb();
    const doc = database
      .prepare(`SELECT * FROM documents WHERE id = ?`)
      .get(documentId) as {
      id: string;
      title: string;
      file_path: string | null;
      verification_status: string;
    } | undefined;

    if (!doc) return { ok: false, chunks: 0, embedded: 0, method: "none", error: "not found" };
    if (doc.verification_status !== "verified") {
      return { ok: false, chunks: 0, embedded: 0, method: "none", error: "not verified" };
    }
    if (!doc.file_path) {
      return { ok: false, chunks: 0, embedded: 0, method: "none", error: "no file" };
    }

    const { text, method } = extractTextFromFile(doc.file_path);
    if (!text || text.length < 40) {
      return {
        ok: false,
        chunks: 0,
        embedded: 0,
        method,
        error: "insufficient text — install pdftotext (poppler) and/or tesseract for OCR",
      };
    }

    const pieces = chunkText(text);
    database.prepare(`DELETE FROM document_chunks WHERE document_id = ?`).run(documentId);
    try {
      database.prepare(`DELETE FROM document_chunks_fts WHERE document_id = ?`).run(documentId);
    } catch { /* */ }
    try {
      database.prepare(`DELETE FROM chunk_embeddings WHERE document_id = ?`).run(documentId);
    } catch { /* */ }

    const insert = database.prepare(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content, page_number, section)
       VALUES (?, ?, ?, ?, NULL, NULL)`
    );
    const insertFts = database.prepare(
      `INSERT INTO document_chunks_fts (content, document_id, chunk_id, title) VALUES (?, ?, ?, ?)`
    );

    let i = 0;
    let embedded = 0;
    const embedOn =
      process.env.EMBED_ON_INDEX !== "0" && process.env.EMBED_ON_INDEX !== "false";

    for (const content of pieces) {
      const chunkId = randomUUID();
      insert.run(chunkId, documentId, i, content);
      try {
        insertFts.run(content, documentId, chunkId, doc.title);
      } catch { /* */ }
      if (embedOn) {
        const ok = await upsertChunkEmbedding(chunkId, documentId, `${doc.title}\n${content}`);
        if (ok) embedded += 1;
      }
      i += 1;
    }

    return { ok: true, chunks: pieces.length, embedded, method };
  } catch (e) {
    return {
      ok: false,
      chunks: 0,
      embedded: 0,
      method: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function listVerifiedChunks(): Array<{
  id: string;
  document_id: string;
  title: string;
  content: string;
  source_url: string | null;
  authority: string;
  chunk_index: number;
}> {
  try {
    return getDb()
      .prepare(
        `SELECT c.id, c.document_id, c.content, c.chunk_index,
                d.title, d.source_url, d.authority
         FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE d.verification_status = 'verified'
         ORDER BY d.updated_at DESC, c.chunk_index ASC
         LIMIT 5000`
      )
      .all() as Array<{
      id: string;
      document_id: string;
      title: string;
      content: string;
      source_url: string | null;
      authority: string;
      chunk_index: number;
    }>;
  } catch {
    return [];
  }
}

export function listChunksForDocument(documentId: string): Array<{
  id: string;
  chunk_index: number;
  content: string;
}> {
  try {
    return getDb()
      .prepare(
        `SELECT id, chunk_index, content FROM document_chunks WHERE document_id = ? ORDER BY chunk_index`
      )
      .all(documentId) as Array<{ id: string; chunk_index: number; content: string }>;
  } catch {
    return [];
  }
}

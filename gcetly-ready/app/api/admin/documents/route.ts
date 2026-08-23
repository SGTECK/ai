import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessAdmin } from "@/lib/adminGuard";
import {
  listDocuments,
  registerPendingDocument,
  setDocumentStatus,
  type VerificationStatus,
} from "@/lib/documentStore";
import { listChunksForDocument } from "@/lib/documentProcess";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Admin document center API (Phase E skeleton).
 * GET  — list documents (?status=pending|verified|rejected)
 * POST — multipart upload → pending review (never auto-indexed)
 * PATCH — { id, status: verified|rejected } approve/reject
 */
export async function GET(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status") as VerificationStatus | null;
  const documentId = req.nextUrl.searchParams.get("documentId");
  try {
    if (documentId) {
      const chunks = listChunksForDocument(documentId);
      return NextResponse.json({ documentId, chunks, total: chunks.length });
    }
    const docs = listDocuments(status || undefined);
    return NextResponse.json({
      total: docs.length,
      documents: docs.map((d) => ({
        ...d,
        analysis: d.analysis_json ? JSON.parse(d.analysis_json) : null,
        analysis_json: undefined,
        file_path: undefined, // don't leak server paths
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");
    const title = String(form.get("title") || "").trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const doc = registerPendingDocument({
      title,
      filename: file.name || "upload.bin",
      bytes: buf,
      source: String(form.get("source") || "") || undefined,
      source_url: String(form.get("source_url") || "") || undefined,
    });
    return NextResponse.json({
      ok: true,
      message: "Stored as pending — not in production RAG until approved.",
      document: {
        ...doc,
        analysis: doc.analysis_json ? JSON.parse(doc.analysis_json) : null,
        analysis_json: undefined,
        file_path: undefined,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as { id?: string; status?: string };
    if (!body.id || !body.status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 });
    }
    if (body.status !== "verified" && body.status !== "rejected" && body.status !== "archived") {
      return NextResponse.json({ error: "status must be verified|rejected|archived" }, { status: 400 });
    }
    const result = await setDocumentStatus(body.id, body.status as "verified" | "rejected" | "archived");
    if (!result.doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const doc = result.doc;
    return NextResponse.json({
      ok: true,
      document: {
        ...doc,
        analysis: doc.analysis_json ? JSON.parse(doc.analysis_json) : null,
        analysis_json: undefined,
        file_path: undefined,
      },
      index: result.index,
      note:
        body.status === "verified"
          ? result.index?.ok
            ? `Verified and indexed (${result.index.chunks} chunks via ${result.index.method}).`
            : `Verified but indexing incomplete: ${result.index?.error || "unknown"}`
          : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}

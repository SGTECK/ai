import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessAdmin } from "@/lib/adminGuard";
import { getDb } from "@/lib/db";
import { getFAQs, getKnowledgeBase } from "@/lib/knowledgeStore";
import { getLlmStatus } from "@/lib/llm";
import { listDocuments } from "@/lib/documentStore";
import { analyticsSummary } from "@/lib/analytics";
import { embeddingStats } from "@/lib/vectorStore";

export const runtime = "nodejs";

/**
 * Admin dashboard numbers (Phase I skeleton — API only).
 */
export async function GET(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;

  let chunkCount = 0;
  let feedbackUp = 0;
  let feedbackDown = 0;
  try {
    const database = getDb();
    const c = database.prepare(`SELECT COUNT(*) as n FROM document_chunks`).get() as {
      n: number;
    };
    chunkCount = c?.n ?? 0;
    const fb = database
      .prepare(
        `SELECT rating, COUNT(*) as n FROM feedback GROUP BY rating`
      )
      .all() as { rating: string; n: number }[];
    for (const row of fb) {
      if (row.rating === "up") feedbackUp = row.n;
      if (row.rating === "down") feedbackDown = row.n;
    }
  } catch {
    /* sqlite optional */
  }

  const pending = listDocuments("pending").length;
  const verified = listDocuments("verified").length;
  const rejected = listDocuments("rejected").length;

  return NextResponse.json({
    knowledge: {
      faqEntries: getFAQs().length,
      knowledgeEntries: getKnowledgeBase().length,
      documentChunks: chunkCount,
      documentsPending: pending,
      documentsVerified: verified,
      documentsRejected: rejected,
    },
    feedback: { up: feedbackUp, down: feedbackDown },
    llm: getLlmStatus(),
    embeddings: embeddingStats(),
    analytics: analyticsSummary(30),
    timestamp: new Date().toISOString(),
  });
}

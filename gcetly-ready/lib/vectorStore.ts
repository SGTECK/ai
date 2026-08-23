/**
 * Lightweight vector store in SQLite (chunk_embeddings).
 * Hybrid with BM25: retrieve() can boost/add vector hits.
 */

import { getDb } from "./db";
import {
  embedText,
  float32ToBuffer,
  bufferToFloat32,
  cosineSimilarity,
  getEmbedModel,
} from "./embeddings";

export async function upsertChunkEmbedding(
  chunkId: string,
  documentId: string,
  text: string
): Promise<boolean> {
  const vec = await embedText(text);
  if (!vec) return false;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO chunk_embeddings (chunk_id, document_id, dim, embedding, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chunk_id) DO UPDATE SET
         dim=excluded.dim, embedding=excluded.embedding, model=excluded.model, created_at=excluded.created_at`
    )
    .run(chunkId, documentId, vec.length, float32ToBuffer(vec), getEmbedModel(), now);
  return true;
}

export async function searchSimilarChunks(
  query: string,
  topK = 6
): Promise<Array<{ chunk_id: string; document_id: string; score: number }>> {
  const q = await embedText(query);
  if (!q) return [];
  let rows: Array<{ chunk_id: string; document_id: string; embedding: Buffer }> = [];
  try {
    rows = getDb()
      .prepare(`SELECT chunk_id, document_id, embedding FROM chunk_embeddings LIMIT 5000`)
      .all() as Array<{ chunk_id: string; document_id: string; embedding: Buffer }>;
  } catch {
    return [];
  }
  const scored = rows.map((r) => {
    const v = bufferToFloat32(Buffer.from(r.embedding));
    return {
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      score: cosineSimilarity(q, v),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0.35).slice(0, topK);
}

export function embeddingStats(): { count: number; model: string } {
  try {
    const row = getDb()
      .prepare(`SELECT COUNT(*) as n FROM chunk_embeddings`)
      .get() as { n: number };
    return { count: row?.n ?? 0, model: getEmbedModel() };
  } catch {
    return { count: 0, model: getEmbedModel() };
  }
}

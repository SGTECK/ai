
import { retrieve, type RetrievalResult } from "./retrieval";
import { searchSimilarChunks } from "./vectorStore";
import type { ChatMessage } from "./types";
import { listVerifiedChunks } from "./documentProcess";

/**
 * BM25 first, then merge vector-similar admin chunks (Ollama embeddings).
 */
export async function hybridRetrieve(
  message: string,
  history: ChatMessage[],
  topK = 6
): Promise<RetrievalResult> {
  const base = retrieve(message, history, topK);
  if (process.env.VECTOR_RETRIEVAL === "0") return base;

  try {
    const vecHits = await searchSimilarChunks(message, topK);
    if (!vecHits.length) return base;

    const byId = new Map(listVerifiedChunks().map((c) => [c.id, c]));
    const items = [...base.items];
    const seen = new Set(items.map((i) => i.text.slice(0, 80)));

    for (const hit of vecHits) {
      const ch = byId.get(hit.chunk_id);
      if (!ch) continue;
      const key = ch.content.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        text: ch.content,
        source: ch.source_url || `document:${ch.document_id}`,
        title: ch.title,
        category: "GENERAL_INFORMATION",
        lastChecked: new Date().toISOString().slice(0, 10),
        score: hit.score * 10, // scale cosine into ranking band
        kind: "knowledge",
      });
    }

    items.sort((a, b) => b.score - a.score);
    const trimmed = items.slice(0, topK);
    return {
      items: trimmed,
      topScore: trimmed[0]?.score ?? base.topScore,
    };
  } catch {
    return base;
  }
}

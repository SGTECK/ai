/**
 * Local embeddings via Ollama (/api/embeddings) — zero cloud cost when Ollama is up.
 * Default model: nomic-embed-text (pull: ollama pull nomic-embed-text)
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 60_000);

export function getEmbedModel(): string {
  return EMBED_MODEL;
}

export async function embedText(text: string): Promise<number[] | null> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!input) return null;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) return null;
    return data.embedding;
  } catch {
    return null;
  }
}

export function float32ToBuffer(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf;
}

export function bufferToFloat32(buf: Buffer): number[] {
  const n = Math.floor(buf.length / 4);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

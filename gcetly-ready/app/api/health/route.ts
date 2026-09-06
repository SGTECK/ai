import { NextResponse } from "next/server";
import { getFAQs, getKnowledgeBase } from "@/lib/knowledgeStore";
import { rateLimitBackendName } from "@/lib/rateLimit";
import { feedbackBackendName } from "@/lib/feedbackStore";
import { getDb, getDbPath } from "@/lib/db";
import { getLlmStatus, warmModel } from "@/lib/llm";
import fs from "node:fs";
import path from "node:path";
import { isWebSearchConfigured } from "@/lib/webSearch";
import { getServerCapacity } from "@/lib/serverCapacity";

export const runtime = "nodejs";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

async function checkOllama(): Promise<{
  reachable: boolean;
  modelPulled: boolean;
  detail: string;
}> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok)
      return {
        reachable: false,
        modelPulled: false,
        detail: `Ollama responded with ${res.status}`,
      };
    const data = await res.json();
    const models: string[] = Array.isArray(data.models)
      ? data.models.map((m: any) => m.name)
      : [];
    const modelPulled = models.some(
      (name) => name === MODEL || name.startsWith(`${MODEL.split(":")[0]}:`)
    );
    return {
      reachable: true,
      modelPulled,
      detail: modelPulled
        ? `${MODEL} is available`
        : `${MODEL} not found -- run "ollama pull ${MODEL}". Available: ${models.join(", ") || "(none pulled)"}`,
    };
  } catch (err) {
    return {
      reachable: false,
      modelPulled: false,
      detail: `Can't reach Ollama at ${OLLAMA_HOST} -- is "ollama serve" running? (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function lastKnowledgeUpdate(): string | null {
  try {
    const curated = path.join(process.cwd(), "data", "gcetly-knowledge.json");
    const auto = path.join(process.cwd(), "data", "gcetly-knowledge.auto.json");
    let latest = 0;
    if (fs.existsSync(curated)) latest = Math.max(latest, fs.statSync(curated).mtimeMs);
    if (fs.existsSync(auto)) latest = Math.max(latest, fs.statSync(auto).mtimeMs);
    return latest ? new Date(latest).toISOString() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  let knowledgeCount = 0;
  let faqCount = 0;
  let dataError: string | null = null;

  try {
    knowledgeCount = getKnowledgeBase().length;
    faqCount = getFAQs().length;
  } catch (err) {
    dataError = err instanceof Error ? err.message : "Failed to load data files";
  }

  const ollama = await checkOllama();
  const lastUpdate = lastKnowledgeUpdate();
  const searxngConfigured = Boolean(process.env.SEARXNG_URL);
  const braveConfigured = Boolean(process.env.BRAVE_API_KEY);

  let warm: { ok: boolean; detail: string } | undefined;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("warm") === "1" && ollama.reachable && ollama.modelPulled) {
      warm = await warmModel();
    }
  } catch {
    /* ignore */
  }

  const status =
    dataError || !ollama.reachable || !ollama.modelPulled ? "degraded" : "ok";

  const isProd = process.env.NODE_ENV === "production";

  // Strix-style info disclosure: minimize production health surface
  if (isProd) {
    return NextResponse.json({
      status,
      ollama: {
        reachable: ollama.reachable,
        modelPulled: ollama.modelPulled,
        detail: ollama.reachable
          ? (ollama.modelPulled ? "ok" : "model missing")
          : "unreachable",
      },
      provider: (getLlmStatus() as { provider?: string }).provider ?? "unknown",
      knowledgeEntries: knowledgeCount,
      faqEntries: faqCount,
      documentChunks: (() => { try { return (getDb().prepare("SELECT COUNT(*) as n FROM document_chunks").get() as {n:number}).n; } catch { return 0; } })(),
      lastKnowledgeUpdate: lastUpdate,
      capacity: getServerCapacity(),
      webSearchConfigured: isWebSearchConfigured(),
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    status,
    ollama,
    model: MODEL,
    llm: getLlmStatus(),
    knowledgeEntries: knowledgeCount,
    faqEntries: faqCount,
    lastKnowledgeUpdate: lastUpdate,
    capacity: getServerCapacity(),
    webSearch: {
      enabled: true,
      primary: searxngConfigured ? "searxng" : braveConfigured ? "brave" : "duckduckgo",
      searxngConfigured,
      braveConfigured,
      note: "Self-hosted SearXNG is preferred; DuckDuckGo remains the no-key fallback",
    },
    rateLimitBackend: rateLimitBackendName(),
    feedbackBackend: feedbackBackendName(),
    sqlitePath: getDbPath(),
    dataError,
    warm,
    timestamp: new Date().toISOString(),
  });
}

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";

interface HealthPayload {
  status?: string;
  lastKnowledgeUpdate?: string | null;
  ollama?: { reachable?: boolean; modelPulled?: boolean; detail?: string };
  llm?: { provider?: string; note?: string };
  model?: string;
  knowledgeEntries?: number;
  faqEntries?: number;
}

/**
 * Clear system status for users:
 * - Error when local model is required but down
 * - Quiet “knowledge as of” when healthy
 * - Neutral note when using OpenRouter (cloud) so staff aren’t confused by Ollama-only wording
 */
export default function StatusBanner({ language = "en" }: { language?: "en" | "ta" }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as HealthPayload;
        if (!cancelled) setHealth(data);
      } catch {
        if (!cancelled) {
          setHealth({
            status: "degraded",
            ollama: { reachable: false, detail: "Health check failed" },
          });
        }
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!health) return null;

  const provider = health.llm?.provider || "ollama";
  const usingCloud = provider === "openrouter";

  const ollamaDown =
    !usingCloud &&
    (health.status === "degraded" ||
      health.ollama?.reachable === false ||
      health.ollama?.modelPulled === false);

  if (ollamaDown) {
    const detail =
      health.ollama?.detail ||
      (language === "ta" ? "உள்ளூர் AI மாதிரி கிடைக்கவில்லை" : "Local AI model unavailable");
    return (
      <div
        role="alert"
        className="px-3 py-2 text-[11px] flex items-start gap-2 bg-red-500/10 border-b border-red-400/30 text-red-300"
      >
        <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          {language === "ta"
            ? "உதவியாளர் தற்காலிகமாக கிடைக்கவில்லை. "
            : "Assistant temporarily unavailable. "}
          {detail}.{" "}
          {language === "ta"
            ? "பின்னர் முயலவும் அல்லது gcetly.ac.in ஐப் பார்க்கவும்."
            : "Try again later or visit gcetly.ac.in."}
        </span>
      </div>
    );
  }

  const updated = health.lastKnowledgeUpdate
    ? new Date(health.lastKnowledgeUpdate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="px-3 py-1.5 text-[10px] flex items-center gap-1.5 border-b border-white/[0.04] text-slate-500 bg-surface/80">
      {usingCloud ? (
        <Sparkles size={11} className="text-accentSoft/80 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 size={11} className="text-emerald-500/80 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">
        {usingCloud
          ? language === "ta"
            ? "கிளவுட் மாதிரி · "
            : "Cloud model · "
          : language === "ta"
            ? "அறிவுத் தளம்: "
            : "Knowledge as of "}
        {updated ? (
          <span className="text-slate-400">{updated}</span>
        ) : (
          <span className="text-slate-400">
            {language === "ta" ? "தயார்" : "ready"}
          </span>
        )}
        {typeof health.knowledgeEntries === "number" && (
          <span className="text-slate-600">
            {" "}
            · {health.knowledgeEntries} entries
          </span>
        )}
      </span>
    </div>
  );
}

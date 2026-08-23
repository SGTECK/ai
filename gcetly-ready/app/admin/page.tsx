"use client";

import { useCallback, useState } from "react";

type Tab = "stats" | "documents" | "analytics" | "pipeline";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<Tab>("documents");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [docs, setDocs] = useState<unknown[]>([]);
  const [chunks, setChunks] = useState<unknown[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const headers = useCallback(() => ({ Authorization: `Bearer ${token.trim()}` }), [token]);

  async function loadStats() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/stats", { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadDocs() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/documents?status=${encodeURIComponent(statusFilter)}`,
        { headers: headers() }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setDocs(data.documents || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadChunks(id: string) {
    setSelectedId(id);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/documents?documentId=${encodeURIComponent(id)}`,
        { headers: headers() }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setChunks(data.chunks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function setDocStatus(id: string, status: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/documents", {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.index && !data.index.ok) {
        setError(`Indexed with issue: ${data.index.error || "check OCR/pdftotext"}`);
      }
      await loadDocs();
      await loadStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(files: FileList | null, title: string) {
    if (!files?.length || !title.trim()) {
      setError("Title and at least one file required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const form = new FormData();
        form.set("file", file);
        form.set("title", files.length > 1 ? `${title.trim()} (${file.name})` : title.trim());
        const res = await fetch("/api/admin/documents", {
          method: "POST",
          headers: headers(),
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
      }
      setStatusFilter("pending");
      setTab("documents");
      await loadDocs();
      await loadStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={
        "px-3 py-1.5 rounded-lg text-sm " +
        (tab === id ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700")
      }
    >
      {label}
    </button>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1">GCE-TLY Admin — Advanced</h1>
      <p className="text-sm text-slate-400 mb-4">
        Upload → review → approve (extract / OCR / chunk / embed) → RAG
      </p>

      <input
        type="password"
        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm mb-4"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        data-testid="admin-token"
        placeholder="ADMIN_ACCESS_TOKEN"
        autoComplete="off"
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {tabBtn("documents", "Documents")}
        {tabBtn("pipeline", "Upload pipeline")}
        {tabBtn("stats", "Knowledge stats")}
        {tabBtn("analytics", "Analytics")}
        <button
          type="button"
          disabled={busy || !token.trim()}
          onClick={() => {
            loadStats();
            loadDocs();
          }}
          className="px-3 py-1.5 rounded-lg bg-emerald-700 text-sm disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-amber-400 text-sm mb-4" role="alert">
          {error}
        </p>
      )}

      {tab === "pipeline" && (
        <section className="border border-slate-800 rounded-xl p-4 mb-6 space-y-3">
          <h2 className="font-semibold text-sm">Multi-file upload → pending</h2>
          <ol className="text-xs text-slate-400 list-decimal ml-4 space-y-1">
            <li>Upload PDF/TXT/HTML/images (pending)</li>
            <li>Review heuristic analysis</li>
            <li>Approve &amp; index → pdftotext / tesseract OCR if installed → chunks → FTS → embeddings</li>
            <li>Chat retrieval picks up verified chunks (BM25 + vectors)</li>
          </ol>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const input = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
              onUpload(input.files, String(fd.get("title") || ""));
              e.currentTarget.reset();
            }}
          >
            <input
              name="title"
              placeholder="Batch / document title"
              className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              required
            />
            <input name="file" type="file" multiple className="text-sm" required />
            <button
              type="submit"
              disabled={busy || !token.trim()}
              className="px-3 py-1.5 rounded-lg bg-emerald-700 text-sm disabled:opacity-40"
            >
              Upload to pending
            </button>
          </form>
          <p className="text-[11px] text-slate-500">
            Server OCR: install <code>tesseract</code> and <code>pdftotext</code> (poppler-utils). Embeddings:{" "}
            <code>ollama pull nomic-embed-text</code>
          </p>
        </section>
      )}

      {tab === "stats" && stats && (
        <pre className="text-xs bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-auto max-h-[70vh]">
          {JSON.stringify(
            {
              knowledge: stats.knowledge,
              embeddings: stats.embeddings,
              feedback: stats.feedback,
              llm: stats.llm,
            },
            null,
            2
          )}
        </pre>
      )}

      {tab === "analytics" && stats && (
        <div className="space-y-4">
          <pre className="text-xs bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-auto">
            {JSON.stringify((stats as { analytics?: unknown }).analytics, null, 2)}
          </pre>
          <p className="text-xs text-slate-500">
            Query text is truncated; no full private chat logs stored by default.
          </p>
        </div>
      )}

      {tab === "documents" && (
        <section>
          <div className="flex gap-2 mb-3">
            <select
              className="rounded-lg bg-slate-900 border border-slate-700 text-sm px-2"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="pending">pending</option>
              <option value="verified">verified</option>
              <option value="rejected">rejected</option>
            </select>
            <button
              type="button"
              className="text-sm px-2 py-1 bg-slate-800 rounded"
              onClick={loadDocs}
              disabled={!token.trim()}
            >
              Load
            </button>
          </div>
          <ul className="space-y-3">
            {docs.map((raw) => {
              const d = raw as {
                id: string;
                title: string;
                verification_status: string;
                analysis?: { relevance_estimate?: number; authority?: string; method?: string };
              };
              return (
                <li key={d.id} className="border border-slate-800 rounded-xl p-3 text-sm">
                  <p className="font-medium">{d.title}</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {d.verification_status}
                    {d.analysis?.authority ? ` · ${d.analysis.authority}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {d.verification_status === "pending" && (
                      <>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-emerald-800 text-xs"
                          onClick={() => setDocStatus(d.id, "verified")}
                        >
                          Approve · extract · chunk · embed
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-red-900 text-xs"
                          onClick={() => setDocStatus(d.id, "rejected")}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {d.verification_status === "verified" && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-slate-700 text-xs"
                        onClick={() => loadChunks(d.id)}
                      >
                        Preview chunks
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {selectedId && chunks.length > 0 && (
            <div className="mt-4 border border-slate-700 rounded-xl p-3">
              <h3 className="text-xs font-semibold mb-2">Chunks ({chunks.length})</h3>
              <ul className="space-y-2 max-h-64 overflow-auto">
                {chunks.map((c) => {
                  const ch = c as { id: string; chunk_index: number; content: string };
                  return (
                    <li key={ch.id} className="text-[11px] text-slate-300 bg-slate-900/80 p-2 rounded">
                      <span className="text-slate-500">#{ch.chunk_index}</span> {ch.content.slice(0, 280)}
                      {ch.content.length > 280 ? "…" : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-slate-600 mt-10">
        <a href="/" className="underline">
          Back to chat
        </a>
      </p>
    </main>
  );
}

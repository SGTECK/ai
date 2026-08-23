# Implementation progress (priority order)

## Done this cycle

### P0 Performance
- BM25 retrieval (existing) + **retrieval query cache**
- **Answer cache** for repeat FAQ questions (empty history)
- **Query router** — skip web when local evidence is enough
- FREE_MODE topK/history trim (existing)
- Ollama keep_alive / warm (existing)

### P1 Accuracy
- Source priority weights + FAQ boost (existing)
- Query expansion (existing)
- Grounding + confidence refusal (existing)
- Router prefers official local knowledge before web

### P2 RAG scale (foundation)
- SQLite tables: `documents`, `document_chunks`
- Still serving chat from BM25 JSON (correct for current size)

### P3–P6 Document admin (skeleton)
- `POST/GET/PATCH /api/admin/documents`
- Upload → **pending** → approve/reject (never auto-RAG)
- Heuristic analysis JSON for admin review

### P7 Live web
- Existing Brave/DDG + router-gated

### P8 Model flexibility
- `LLM_PROVIDER=ollama | openrouter | huggingface`
- Soft fallback to Ollama if cloud key missing

### P9 UI
- Deferred (prompt: performance & accuracy first)

### P3 document processing (continued)
- `lib/documentProcess.ts` — extract txt/md/html/csv + best-effort PDF strings
- Chunking into `document_chunks` on **approve**
- Verified chunks merged into **BM25** corpus

## Not done yet (next slices)
- PDF/DOCX text extraction + OCR after approve
- Embeddings + vector index when corpus is large
- Full `/admin` HTML dashboard
- Scheduled crawlers + 1000+ page controlled expansion
- Automatic knowledge versioning UI

## Env additions
- `HF_TOKEN`, `HF_MODEL`
- `RETRIEVAL_CACHE_TTL_MS`, `ANSWER_CACHE_TTL_MS`
- `ADMIN_ACCESS_TOKEN` (required for document APIs)


### Continued (auto)
- `/api/admin/stats` — knowledge + feedback + LLM status counts
- Upload extension allowlist (no arbitrary binaries)
- System prompt rules 13–14: docs as data, conflict handling
- Version 3.7.0

### Continued again
- SQLite **FTS5** for approved document chunks
- Retrieval **freshness boost** (newer lastChecked ranks slightly higher)
- Minimal **`/admin`** console (token, stats, upload, approve/reject)

# GCE-TLY AI Assistant — Architecture Audit (Phase 0)

**Date:** 2026-08-20  
**Codebase version:** 3.6.x (gcetly-nextjs)  
**Auditor role:** Inspect-first; no blind rewrite.

---

## 1. Current architecture (what exists)

```
Browser (ChatWindow)
  → POST /api/chat
      → rate limit (session + IP)
      → requestSecurity (sanitize)
      → retrieve() BM25 over FAQ + knowledge JSON
      → optional liveWebSearch (Brave / DDG) if needsCurrentInfo
      → buildSystemPrompt (grounding rules)
      → streamChat via lib/llm.ts
            → ollama | openrouter
  → SSE stream to UI
```

| Layer | Implementation |
|-------|----------------|
| UI | Next.js 14 App Router, Tailwind, dark/light |
| API | `/api/chat`, `/health`, `/warm`, `/feedback`, `/session/new`, `/admin/*` |
| RAG | **BM25** on in-memory corpus from JSON (`lib/retrieval.ts`) |
| Knowledge | `data/gcetly-knowledge.json` (~30 entries), `gcetly-faq.json` (~39) |
| LLM | `LLM_PROVIDER=ollama \| openrouter` |
| DB | SQLite for rate limits / optional feedback (`lib/db.ts`) |
| Security | middleware CSP, admin Bearer, urlSafety, rate limits |
| Crawl | `scripts/crawl-gcetly.ts`, `update-knowledge.ts` |
| Tests | `test-questions`, `test-crawler`, `eval-hallucination` |

---

## 2. Existing features (working design)

- Grounded chat with citations + confidence bands  
- BM25 retrieval + query expansion + source priority  
- Small-talk bypass (no false “couldn’t verify” on “Hi”)  
- Optional web search when “latest/current” detected  
- Ollama + OpenRouter provider switch  
- FREE_MODE (smaller context, topK, history)  
- Rate limiting, input validation, admin auth  
- Feedback, local conversation history (browser)  
- Security headers, safe URLs, Markdown escape  
- Crawler scripts + knowledge update path  
- Eval harness for hallucination/refusal  

---

## 3. Incomplete / limited (not necessarily “broken”)

| Area | Reality |
|------|---------|
| Knowledge scale | ~70 FAQ+KB chunks — **not** 1000+ pages |
| Vector DB | **None** — BM25 on JSON is correct for current size |
| PDF/DOCX ingest | **Not implemented** |
| Admin UI `/admin` | API-only admin (token); **no full dashboard** |
| Document approval workflow | **Missing** |
| HuggingFace provider | **Missing** (only ollama/openrouter) |
| Scheduled self-update | Scripts exist; **no cron/dashboard** |
| Embeddings / reranker | **Missing** |
| Anna University corpus | Not systematically ingested |

---

## 4. Performance bottlenecks (P0)

1. **Cold Ollama** — first token slow without warm/`keep_alive`  
2. **Web search latency** — DDG/Brave adds 1–3s when triggered  
3. **No retrieval cache** — same question re-scores full corpus every time  
4. **History in every call** — mitigated by FREE_MODE trim  
5. **Client bundle** — acceptable for single chat page; not the main cost vs LLM  

---

## 5. RAG weaknesses

- Small curated corpus → good precision, limited coverage  
- No semantic paraphrase matching (BM25 is lexical)  
- No cross-encoder rerank  
- Conflicts between sources only partially handled in prompt  
- Freshness depends on manual crawl/update  

---

## 6. Security (post hard-security pass)

**Strong:** admin auth, rate limits, CSP, input sanitize, no keys in client, URL allowlist.  
**Ops residual:** don’t expose Ollama publicly; set `ADMIN_ACCESS_TOKEN`; `npm audit`; HTTPS.

---

## 7. Database limitations

SQLite is fine for rate limits/feedback.  
**JSON files are not a 1000-doc vector store** — upgrade only when corpus grows.

---

## 8. Recommended architecture (evolutionary, not big-bang)

**Keep now:** Next.js + BM25 + JSON + Ollama/OpenRouter + grounding prompts.  

**Add when needed (order):**

1. Retrieval + answer **caching** (P0)  
2. Smarter query router (skip web when local score high) (P0/P1)  
3. Expand **curated** KB via existing crawler (P2)  
4. SQLite FTS or lightweight vectors **after** >2–5k chunks  
5. Admin upload → pending → approve → chunk (P3–P6)  
6. HF provider as third `LLM_PROVIDER` (P8)  
7. Full `/admin` UI last among core features (P6/P9)  

**Do not** prioritize animations over P0/P1.

---

## 9. Implementation roadmap

| Phase | Focus | Effort |
|-------|--------|--------|
| **A** | Audit (this doc) | Done |
| **B** | Build/runtime health | As needed |
| **C** | Performance: cache, router, warm | Days |
| **D** | Accuracy: corpus expansion, conflict notes | Days–weeks |
| **E** | Document upload + approval | Weeks |
| **F** | Vector/FTS at scale | Weeks |
| **G–H** | Controlled crawl + scheduled updates | Weeks |
| **I–J** | Admin dashboard + UI polish | Weeks |

---

## 10. Honest scope for “implement the full master prompt”

The master prompt describes a **full product** (vector RAG, OCR, 1000+ pages, admin center, schedulers). That is **months** of work, not one session.

**Immediate implementation (next):** Phase C performance only — retrieval cache + stricter local-first web routing — without breaking existing chat.

# GCE-TLY AI Assistant

> **First command after download:** `npm install`  
> Then see **[START_HERE.md](./START_HERE.md)** or run `./setup.sh`

Official AI information assistant for **Government College of Engineering, Tirunelveli** (https://gcetly.ac.in/). Next.js 14 (App Router) + TypeScript + Tailwind CSS, grounded in a real, verified knowledge base and FAQ dataset built from the official website.


**LLM backend: local Ollama, not a paid API.** This project went through two architecture pivots, worth knowing about honestly: it started as a fully-local Python/Ollama/ChromaDB stack, moved to the Next.js/Claude-API version this file used to describe, and has now moved back to local inference — this time inside the same Next.js codebase, not a separate rewrite — specifically because ongoing Claude API costs weren't viable for this deployment. See "v3.1" below for exactly what that means in practice, including a real constraint worth reading before you deploy: **Ollama and Vercel don't mix.**

## Ollama speed tips

The chat client (`lib/ollama.ts`) is tuned for fast, short college answers:

| Setting | Default | Effect |
|---------|---------|--------|
| `OLLAMA_KEEP_ALIVE` | `30m` | Keeps model in RAM (avoids multi-second reloads) |
| `OLLAMA_NUM_CTX` | `4096` | Smaller context → faster prefill |
| `OLLAMA_NUM_PREDICT` | `512` | Caps answer length |
| `OLLAMA_TEMPERATURE` | `0.3` | Faster, more focused sampling |
| `think: false` | on for qwen3 | Skips slow chain-of-thought |

Warm the model after boot:

```bash
curl -X POST http://localhost:3000/api/warm
# or
curl "http://localhost:3000/api/health?warm=1"
```

**Hardware:** GPU is the biggest win. For CPU-only, try a smaller model (`qwen2.5:3b` or `phi3:mini`) and set `OLLAMA_NUM_THREAD` to your core count.

## v3.5 — Production hardening pass

- **Status banner** — Ollama-down alert or “Knowledge as of …” from `/api/health`
- **FAQ ranking boost** — curated FAQs preferred when scores are close
- **Stricter numeric/date rules** in the system prompt
- **Web search rate limit** — `SEARCH_RATE_LIMIT_PER_MINUTE` (default 10)
- **Expanded KB/FAQ** — principal, NBA, admissions clarify, fees/exams
- **Multi-conversation writes** from ChatWindow (`gcetly-conversations-v1`)
- **Docker Compose + Dockerfile** for self-host with Ollama
- **`.nvmrc`** — Node 22

## v3.4 — SQLite persistence layer

**What was added:**

- Shared SQLite DB at `data/gcetly.db` via Node’s built-in `node:sqlite` (no native addon).
- **Rate limiting** defaults to SQLite (survives restarts). Upstash still preferred when configured.
- **Feedback** defaults to SQLite instead of JSONL. Upstash still preferred when configured.
- **Web search cache** is dual-layer: hot in-memory + SQLite so cache survives process restarts.
- Backend priority everywhere: **Upstash → SQLite → memory/JSONL fallback**.
- `/api/health` reports `rateLimitBackend`, `feedbackBackend`, and `sqlitePath`.
- Requires **Node.js 22.5+** for `node:sqlite` (falls back gracefully on older Node).

## v3.3 — Hybrid live web search (free by default)

**What was added:**

- Live web search via self-hosted SearXNG on the college server, with DuckDuckGo fallback and optional Brave enhancement (`BRAVE_API_KEY`).
- In-memory + SQLite search cache (30 min TTL).
- Triggered for time-sensitive questions, deep-research requests, or low local confidence.
- Multi-site crawl helper: `npm run crawl -- --with-recommended-sites`
- Admin **Refresh knowledge** button rebuilds auto-KB from last crawl.

**Optional Brave enhancement:**
```bash
BRAVE_API_KEY=your_key_here   # free tier: https://brave.com/search/api/
```

Docker Compose starts SearXNG automatically and connects the app to it at
`http://searxng:8080`. For a non-Docker deployment, set `SEARXNG_URL` to the
college server's internal SearXNG URL. The production image uses Next.js
standalone output for a smaller image and faster startup; Ollama is internal
only and is not published to the host network.

## v3.2 — Grounding hardening, confidence UI, retrieval improvements (Aug 2026)

**What was added / changed:**

- **Low-score short-circuit refusal** — if retrieval `topScore` falls into the `none` band, the API returns the exact fallback sentence without ever calling Ollama. This is more reliable than relying on smaller local models to refuse on their own.
- **Confidence badge in the UI** — answers now carry a `confidence` field (`high` / `medium` / `low` / `none`). Medium and low matches show a small warning badge so users know when to double-check the official site.
- **Query expansion + better short-follow-up weighting** — common college abbreviations (HOD, ECE, CSE, TNEA, fees/hostel synonyms) are expanded at query time; very short follow-ups receive extra history weight.
- **Structured Deep Research format** — when the user triggers deep-research phrases, the system prompt forces a fixed markdown template (Answer / Key Information / Sources / Confidence Note) even without live web search.
- **Graceful Ollama-down messages** — connection failures surface a clear “local AI model unavailable” message instead of a raw network error.
- **Expanded health endpoint** — reports knowledge/FAQ counts, last knowledge update timestamp, rate-limit backend, and overall status.
- **Hallucination eval harness** — `npm run test:eval` exercises the retrieval + refusal logic against a set of should-answer / should-refuse questions (no Ollama required).
- **Curated knowledge expanded** — additional entries for 2026–27 admission notices, departments overview, contact numbers, and institutional scale figures. Principal entry refreshed.

**Deployment modes (read before you deploy):**

1. **Recommended – single self-hosted machine**  
   Next.js + Ollama on the same VPS / college server. Simplest, zero external cost, matches the “no money” constraint.

2. **Split**  
   Next.js on Vercel (or similar) + Ollama on a machine you control. Point `OLLAMA_HOST` at that machine. **Do not expose port 11434 to the public internet** without authentication (Cloudflare Tunnel + Access, Tailscale, or a reverse proxy with auth).

3. **Local development only**  
   `ollama serve` + `npm run dev` on your laptop.

**New scripts:**
```bash
npm run test:eval   # retrieval/refusal eval harness
```

## v3.1 — LLM backend swapped to local Ollama (no more API costs)

**Why:** the Claude API has no ongoing free tier — new accounts get a small one-time credit, then it's pay-per-token, indefinitely. That's a hard blocker with no budget. This pass swaps the LLM backend to Ollama, which runs entirely on hardware you control, for zero ongoing cost, ever.

**What changed:** only `lib/anthropic.ts` → `lib/ollama.ts` (same `streamChat()` interface, so `app/api/chat/route.ts` needed minimal edits) and the parts of `lib/systemPrompt.ts` that referenced the web search tool. Everything else — retrieval, the knowledge base, the multi-site crawler, the test suite, every UI component, the admin dashboard — is untouched, because none of it was ever Claude-specific.

**What you lose, stated plainly, not glossed over:**
- **Free live web search is available.** The app uses DuckDuckGo HTML without an API key for current-info and explicit research requests. It is a public external service, so it may occasionally throttle requests; the app rate limit and persistent cache reduce that risk. Brave remains optional, not required.
- **Weaker anti-hallucination discipline.** This is the one that actually matters most for this project's core promise. Claude follows "only answer from the given context" instructions more reliably than most open-source models this size. The system prompt leans harder on explicit refusal instructions to compensate, but **test this with your actual chosen model** before trusting it — this is a real quality tradeoff, not a formality.
- **No API key to configure**, which also means no billing dashboard to check, no rate-limit-from-Anthropic's-side to worry about — one less moving part.

### ⚠️ Ollama and Vercel: read this before you deploy

You mentioned Vercel as the deployment target, and that's now in tension with switching to Ollama. Worth being direct about this rather than letting it surface as a confusing failure later:

**Ollama needs a persistent, always-running process** (`ollama serve`) with the actual model weights on disk. **Vercel's serverless functions cannot do this** — no persistent processes, no way to install multi-gigabyte model files into that environment. Vercel literally cannot host Ollama itself, full stop.

Your real options:
1. **Self-host the whole thing** — Next.js and Ollama on the same machine (a college server, a spare computer that stays on, a cheap VPS). Simplest, most coherent with "no money," and how this README's setup instructions below assume you're running it.
2. **Split it** — deploy the Next.js app to Vercel, but point `OLLAMA_HOST` at a machine you control that's reachable from the internet. Works, but adds real complexity: you need a public IP/domain for that machine, and **Ollama has no built-in authentication** — exposing its port to the internet without putting something in front of it (a reverse proxy with auth, a firewall allowlist, a VPN) means anyone who finds it can use your compute for free. Don't expose `11434` directly to the internet.

Given the budget situation, (1) is almost certainly the right call unless you specifically need Vercel for something else in the stack.

## v3.0 — multi-site crawler, CI automation, and a production-readiness pass

**Provenance note, stated plainly:** the multi-site crawler (`scripts/crawlerCore.ts`'s `SiteConfig`/trust-tier system), the redesigned header, and `.github/workflows/recrawl.yml` were not built in the session that wrote this README section — they arrived already in place. Documenting them here anyway because the changelog discipline this project has followed since v2.0 (say honestly what changed and why) is more useful than a gap in the history. The items below marked "this pass" are what actually got added/fixed this round; everything else in this section is describing what was already true.

**Already in place (multi-site crawler + CI):** the crawler now supports multiple `SiteConfig`s (domain, trust priority 1-4, source label) instead of one hardcoded domain, with links only followed within the domains you explicitly configure — so pointing it at additional sites never turns into an open crawl of the whole internet. A GitHub Actions workflow (`.github/workflows/recrawl.yml`) runs the crawl on a schedule and commits changes — it correctly runs as a GitHub Action rather than a Vercel cron specifically because serverless deployments have an ephemeral filesystem that can't durably hold crawl output, which matches a constraint documented elsewhere in this README.

**This pass — a production-readiness audit found and fixed:**
- **The recrawl pipeline had no safety gate.** It crawled, rebuilt the knowledge base, committed, and pushed straight to main with zero verification in between — directly at odds with this project's own no-hallucination principle. `npm test` now runs after the rebuild and before the commit; a failing test aborts the push.
- **No `package-lock.json` was committed**, which the workflow's own comment already flagged (`npm ci` wasn't usable, so it fell back to `npm install` unconditionally, i.e. non-reproducible every time). The install step now checks for a lockfile and uses `npm ci` automatically once one exists, with a visible GitHub Actions warning in the meantime. Run `npm install` locally once and commit the generated `package-lock.json` to close this out — this is the one item in this list that couldn't be done without network access to the npm registry, which this environment doesn't have.
- **The multi-site crawler logic had zero test coverage.** Added `tests/test-crawler.ts` covering `extractContent` (title/text extraction, boilerplate removal, cross-domain link filtering — the part multi-site support actually depends on, PDF-link separation, malformed-href handling) and `isAllowed` (robots.txt matching). Honest caveat on this one specifically: `scripts/crawlerCore.ts` imports `cheerio` for HTML parsing, and cheerio isn't installed in the sandbox these tests were written in (no network access to `npm install` it) — so this file could be carefully reasoned through but not executed. Run `npm test` yourself to get a real pass/fail; every other test file in this project has zero external dependencies specifically so it doesn't have this limitation.
- **The priority/trust-tier weighting that powers ranking was inline and untested.** Extracted to an exported `priorityWeight()` in `lib/retrieval.ts` and covered with real, verified-passing tests in `tests/test-questions.ts` (kept there rather than in `test-crawler.ts` specifically because it has no cheerio dependency and could actually be run).
- **Rate limiting was in-memory-only**, which matters more now that real CI/deployment infrastructure exists — on serverless with multiple instances, each instance keeps its own counter, so the limit isn't enforced globally. `lib/rateLimit.ts` is now backend-swappable: unchanged in-memory behavior by default, or set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` for a real shared counter. Same honest caveat as the crawler tests: written against Upstash's documented REST API, not verified against a live Upstash instance (no network access here either) — test it yourself before relying on it.
- **Long messages were silently truncated**, not rejected. `.slice(0, 2000)` meant a genuinely long question got quietly cut mid-sentence and answered as if that were the whole question, with no indication anything was cut. Now rejected explicitly with a clear error, both server-side (`app/api/chat/route.ts`) and client-side (a live character counter in `components/ChatWindow.tsx` that appears as you approach the limit).

**Deliberately not touched this pass:** the v3.0 header redesign (dark, app-like styling, a step away from v2.0's "official letterhead" framing). That's a legitimate design direction, not a bug — but it wasn't a decision made with an explicit rationale documented anywhere, and reverting or keeping it is a real judgment call about how this should represent a government institution, not something to change unilaterally without asking first.

## v2.0 — design system rewrite + new features

Applied to the codebase, not just described: verify with `npm test` (100 passing) after `npm install`.

**Design:** the production project's visual language had quietly drifted from the more restrained "academic, trustworthy, no excessive gradient/animation" direction validated in later preview iterations — it was still shipping an indigo→teal diagonal gradient and an unused floating-blob animation keyframe. v2.0 replaces that with a navy/gold letterhead treatment (the header is now styled like an official letterhead rather than a generic chat app bar), a subtle CSS-only "blueprint grid" texture (no image asset) in the empty state, and a real shimmer skeleton loading state instead of a plain "…" placeholder. Sora — loaded via Google Fonts since the very first version but never actually applied anywhere — is now used as the display face for institutional moments, paired with Inter for body text.

**Real gap closed:** the actual official college logo, verified real and used in every preview iteration since V4, had never been backported into this downloadable project — it only ever existed in the browser-only preview artifacts. `components/CollegeLogo.tsx` fixes that, with the same graceful hotlink-fallback pattern already validated in preview.

**New features:**
- **Suggested follow-up questions** after each answer — rule-based (`lib/followUps.ts`), keyed off the top retrieved category, computed server-side and sent alongside the answer. No extra API call, so it can't itself introduce a hallucinated claim — worst case is the same honest fallback as any other question.
- **Edit & resend** your last message — puts it back in the input and truncates the conversation from that point, rather than leaving a stale duplicate thread.
- **Persistent local chat history** (`lib/localHistory.ts`) — resumes your last conversation on reload. This is entirely client-side (localStorage in your own browser) and does **not** conflict with the server-side session-isolation guarantee below — that guarantee is about the *server* holding zero cross-user state; this is the same category of thing as a browser remembering your last open tab.
- **Export conversation** as a Markdown file (`lib/exportChat.ts`), including sources — no new dependency, just a Blob download.
- **Feedback that actually persists** — the thumbs up/down buttons previously only changed their own icon color. `app/api/feedback/route.ts` now logs real ratings to `data/feedback/feedback-log.jsonl`. Honest caveat: this works for the self-hosted/long-running-Node deployment model this README assumes (same assumption the crawler already makes); it will **not** persist reliably on a serverless platform with an ephemeral filesystem (e.g. Vercel's default runtime) — swap in a real datastore there.
- **PWA basics** — `public/manifest.json`, theme-color, apple-touch-icon, so the app is properly installable on Android home screens, matching the "Android-friendly" requirement already in this project's spec. One honest limitation: the manifest icon references the real hotlinked logo with `sizes: "any"` rather than a specific pixel dimension, because I can't verify the source image's actual dimensions without network access in this environment — a self-hosted, properly-sized PNG icon set would be more robust if you want a polished installed-app icon.

**Deliberately not done in this pass** (scope was already large; these deserve their own dedicated round rather than being half-built): a multi-conversation session switcher (this version persists one conversation, not a list of past ones — in progress as of the next pass) and an offline-detection banner. ~~an admin/analytics dashboard for the feedback log~~ — built in a later pass; see `app/admin/page.tsx`.

A full Phase 1-16 audit (inspect → identify problems → fix → test → verify) found that several fixes made during interactive preview iteration had never been backported into this production codebase — most importantly, **the real 429 bug was still live here** even after being fixed in the preview. Confirmed via grep before touching anything (see git-style evidence in the PR-equivalent below), then fixed and re-tested:

| Problem found | Where | Fix |
|---|---|---|
| Zero retry/backoff logic — any transient 429/5xx immediately surfaced as a raw error | `lib/anthropic.ts` | Exponential backoff + jitter (1.5s/3s/6s ±30%), max 3 retries, non-retryable errors (bad key, malformed request) fail fast instead of wasting retries |
| No per-request timeout — a hung connection could block forever | `lib/anthropic.ts` | 30s timeout via `AbortController`, combined with the client's own abort signal |
| Send-guard was only React state, which can lag a fast double-click/Enter combo | `lib/chatClient.ts` | Synchronous module-level lock checked *before* any network call starts |
| Voice input had no error handling at all — permission denial, no-mic, and unsupported-browser all failed identically silently | `components/ChatWindow.tsx` | Extracted to `lib/useVoiceInput.ts`: real state machine (idle/requesting/listening/processing/error) with distinct messages per failure mode, plus unmount cleanup that was previously missing entirely |
| No stop-generation button existed | `components/ChatWindow.tsx`, `lib/chatClient.ts`, `app/api/chat/route.ts`, `lib/anthropic.ts` | `AbortController` wired all the way from the Stop button through the fetch, through Next's `req.signal`, to the upstream Claude call — an aborted request actually cancels upstream, not just the UI |
| "Who is the principal" didn't trigger a live check (spec explicitly names this as an example) | `lib/retrieval.ts` | Added principal/HOD to the current-info trigger patterns |
| "Deep Research Mode" was specified in detail but never implemented | `lib/retrieval.ts`, `lib/systemPrompt.ts` | 8 trigger phrases force web search + switch to the structured Answer/Key Information/Verification/Sources format |
| Source-authority language didn't name Anna University/AICTE/DOTE explicitly, no social-media-verification caveat | `lib/systemPrompt.ts` | Rewrote with explicit tiering and the spec's exact suggested transparency phrasing |
| Citation links only checked `.startsWith("http")` | `components/MessageBubble.tsx` | Added a real `new URL()` parse-and-protocol check before any string becomes an `href` |

All 76 tests pass (`npm test`) — 59 pre-existing + 17 new, including unit tests for the retry/backoff decision logic itself (stress-tested 10x for jitter-related flakiness, none found).

### Second audit pass (same document, sent twice — read as a signal to re-check, not repeat)

Re-auditing the first pass's own report against the checklist found 4 more real gaps and one confirmed-safe non-issue:

| Found | Fix |
|---|---|
| Citations showed raw URLs only, no document title (Phase 6 explicitly asks for this) | `RetrievedItem` and `SourceRef` now carry a real `title` (page title / FAQ question / search-result title where the API provides one) |
| Prompt-injection guard only covered "the user's message," not retrieved CONTEXT or web-search results | Extended explicitly: a crawled page or search result cannot issue instructions, no matter how it's phrased |
| Zero `aria-label`s outside the Stop/Send buttons — Header, QuickActions, MessageBubble's action buttons, and the voice mic/cancel buttons relied on `title` only | Added throughout, plus `role="status"`/`aria-live="polite"` on the voice-state region so screen readers announce state changes |
| `isSafeUrl` (citation validation) existed with zero test coverage | Extracted to standalone `lib/urlSafety.ts`, 6 new tests (javascript:/data:/file: URIs rejected, malformed strings don't throw) |
| Checked: `requestNewSession().then(setSessionId)` has no `.catch()` | **Confirmed safe, not fixed** — the function's own internal try/catch means it can never reject; "fixing" it would be cosmetic, not a real bug |

One test I wrote was itself wrong and caught its own bug: it assumed the first FAQ result for "who is the principal" would always be the principal FAQ specifically — but "Are scholarships available?" legitimately ties on score (its answer mentions "Principal's-office"), so insertion order won that tie. That's correct retrieval behavior, not a bug — the test's assumption was too strict, so I fixed the test, not the code.

All 84 tests pass (76 + 8 new), stability-checked across 5 consecutive runs.

---

## Architecture

```
Official gcetly.ac.in
        |
   scripts/crawl-gcetly.ts        (BFS crawl, robots.txt-aware, incremental)
        v
  data/crawled/pages/*.json        (raw + cleaned text, source URL, timestamp)
        |
   scripts/update-knowledge.ts     (categorize, chunk)
        v
  data/gcetly-knowledge.auto.json  (auto-generated, refreshable)
        +
  data/gcetly-knowledge.json       (hand-curated, verified -- never overwritten)
  data/gcetly-faq.json             (curated Q&A with phrasing variations)
        |
   lib/retrieval.ts                (TF-IDF-weighted keyword retrieval, English+Tamil)
        v
  app/api/chat/route.ts  <-- user question (+ THIS conversation's own history only)
        |
   lib/systemPrompt.ts             (grounding rules, hallucination control, citations)
        v
  lib/ollama.ts                    (local Ollama model, streaming)
        v
   Verified, cited answer  -->  components/ChatWindow.tsx
```

**Why keyword retrieval instead of a vector database?** The project spec explicitly permits "a suitable vector database OR a lightweight local retrieval architecture" and asks for something "simple enough for a student developer to understand and maintain." A TF-IDF-weighted keyword retriever over ~60 curated entries needs no external service, no embedding API calls, and no infrastructure — and its behavior is fully verified in `tests/test-questions.ts` (59 passing tests, see below). This is retrieval, not a trained model — nothing here is a fine-tuned or trained AI; it's the standard crawl → chunk → retrieve → prompt → verified-answer pipeline the spec asks for.

## Why sessions are actually isolated (not just told not to leak)

`app/api/chat/route.ts` holds **no server-side conversation store at all** — no database, no cache, no in-memory map keyed by user or session. The only conversation history that ever reaches the server is whatever the calling browser tab's own React state sends in that single request's body. That means:

- A new chat (fresh page load, or the **New Chat** button, which resets the client's message array to empty and requests a fresh session id from `/api/session/new`) is structurally guaranteed to start with zero prior context — there's nothing server-side that *could* leak in.
- Two different browser tabs or users can never influence each other, because their requests never touch shared mutable state.
- `sessionId` is used **only** as an in-memory rate-limit bucket key (see `lib/rateLimit.ts`) — never to store or look up message content.

This is verified in `tests/test-questions.ts` (the "MEMORY ISOLATION" section) at the retrieval layer, and is true by construction at the API layer — there's simply no code path that could reuse another request's data.

---

## 1. Setup

Requires Node.js 18.17+ and [Ollama](https://ollama.com) installed on the same machine (or one reachable over the network — see the Vercel warning above).

```bash
# 1. Install Ollama: https://ollama.com/download

# 2. Pull a model -- pick based on your hardware:
ollama pull qwen3:8b        # default, ~8-10GB RAM/VRAM, good instruction-following for RAG
# ollama pull llama3.1:8b   # alternative, most widely-tested/documented, similar hardware needs
# ollama pull qwen3:14b     # better quality if you have 16GB+ RAM/VRAM
# ollama pull mistral-small # strong at "answer only from given context", ~12GB

# 3. Start Ollama (leave this running)
ollama serve

# 4. In a separate terminal, set up and run the app
npm install
cp .env.example .env.local
# .env.local defaults already point at localhost:11434 and qwen3:8b --
# only edit it if you picked a different model or Ollama is on another machine
npm run dev
```

Visit http://localhost:3000. Check http://localhost:3000/api/health first if anything seems off — it reports whether Ollama is reachable and whether the model is actually pulled, not just whether the app itself is up.

**Hardware reality check:** local generation is slower than a hosted API, especially without a GPU. On CPU-only hardware, expect answers to take longer to start appearing than you're likely used to from Claude.ai/ChatGPT — this is normal, not a bug. If it's uncomfortably slow, a smaller model (or a machine with a GPU / Apple Silicon) is the fix, not a code change.

## 2. Try it

- "Hi" → a real greeting (this was a confirmed bug in an earlier iteration — "Hi" was hitting the knowledge-base fallback instead of greeting; now covered by a regression test)
- "hostel fees?" → grounded answer with a source citation
- "girls hostel?" → confirms availability with capacity figures
- "who is the ECE HOD?" → honestly reports that the college's own site names two different people in two different places, rather than guessing
- "I want admission" → asks which type (B.E. First Year / Lateral / M.E. / Part-Time) instead of assuming
- "விடுதி கட்டணம் என்ன?" → answers in natural Tamil
- "what's the wifi password" → the exact "I couldn't verify..." fallback (nothing in the knowledge base covers this — proves grounding, not a bug)
- Click **New Chat**, then ask "what is my name?" after previously introducing yourself → confirms no memory carries over

## 3. Testing

```bash
npm test
```

This runs `tests/test-questions.ts`: **59 tests**, all passing, covering every category from the spec (Admissions, Fees, Hostel, Courses, Departments, Placements, Scholarships, Examinations, Facilities, Research, Student Activities, Contact, Notifications), Tamil questions, spelling mistakes, ambiguous questions, unknown/unanswerable questions, the greeting bug-fix regression, and memory isolation. It runs the real retrieval engine against the real data files — no network access or API key required, since it tests the grounding layer directly rather than mocking it.

Sample output:
```
59 passed, 0 failed, 59 total
```

Three real bugs were caught and fixed while building this (not merely theoretical -- see git-style history in this session): "where is the college" wasn't matching CONTACT because "where" was being stripped as a stopword (an over-broad stopword list is a classic retrieval bug); "what is tomorrow's lottery number" was retrieving unrelated FEES/HOSTEL content because the generic word "number" incidentally appears everywhere (phone numbers, room numbers); and the Tamil FAQ dataset initially had zero actual Tamil-language text in it (only English descriptions of Tamil support), so Tamil-only queries retrieved nothing until real Tamil variations were added.

**What this test suite does NOT cover:** the live Claude API call itself (final answer phrasing, clarification-question behavior, live web search results) — that needs a real `ANTHROPIC_API_KEY` and is best verified by actually using the running app, since LLM output isn't deterministic the way retrieval is.

## 4. Crawling fresh content from gcetly.ac.in (and other sites)

```bash
npm run crawl                              # crawl gcetly.ac.in from the homepage, up to 150 pages
npm run crawl -- --max-pages 60            # smaller run
npm run crawl -- --force                   # ignore incremental cache, re-store everything
npm run crawl -- --site "annauniv.edu|https://www.annauniv.edu|government_portal|1|Anna University"
npm run update-knowledge                   # turn the crawl into data/gcetly-knowledge.auto.json
```

`crawl-gcetly.ts` does a breadth-first, same-domain (per configured site) crawl with robots.txt compliance, boilerplate stripping, linked-PDF collection, and an incremental content-hash cache (unchanged pages are skipped on re-crawl). Add `--site` flags to crawl additional trusted sites alongside gcetly.ac.in, each with its own trust tier -- see `scripts/crawlerCore.ts` for the format. `update-knowledge.ts` categorizes and chunks whatever was crawled into `data/gcetly-knowledge.auto.json`, which is loaded **alongside** (never replacing) the hand-curated `data/gcetly-knowledge.json` -- see `lib/knowledgeStore.ts`. Auto-categorization is a best-effort keyword heuristic; skim the output file before fully trusting it, especially for FEES/EXAMINATIONS/NOTIFICATIONS where specific figures and dates matter most.

**Optional JS-rendering fallback:** if a page's static HTML looks too thin (likely client-rendered), the crawler tries Playwright automatically if it's installed (`npm i -D playwright && npx playwright install chromium`); otherwise it just logs a warning and moves on with whatever static content it got.

**Keeping this fresh automatically:** `.github/workflows/recrawl.yml` runs this crawl + rebuild on a daily schedule (or on manual dispatch) and commits `data/gcetly-knowledge.auto.json` back to the repo when it changes, which triggers Vercel to redeploy with the updated knowledge base. This runs in GitHub Actions rather than as a Vercel cron/API route specifically because Vercel's serverless filesystem can't durably persist a crawl's output for the live app to read -- see the comments at the top of that workflow file for the one-time repo settings it needs (Actions write permissions, branch protection exceptions if `main` is protected).

## 5. Voice input — states, limitations, and iframe embedding

`lib/useVoiceInput.ts` implements a real state machine: `idle → requesting → listening → processing → idle`, with a distinct `error` state that names *why* it failed rather than failing silently:

| Failure | Message shown |
|---|---|
| Permission denied | "Microphone access is disabled. Please allow microphone permission in your browser settings." |
| No speech detected | "Didn't catch that — no speech detected. Tap the mic and try again." |
| No microphone on device | "No microphone was found on this device." |
| Browser doesn't support Speech Recognition | "Voice input isn't supported in this browser. Please use Chrome or another supported browser." |
| Not on HTTPS | "Voice input needs a secure (HTTPS) connection." |

The recognition instance and its listeners are torn down on component unmount, so navigating away mid-listen can't leave the microphone active.

**If you embed this app in an iframe on gcetly.ac.in** (per the spec's "floating website assistant" intent): browsers only grant microphone access to an iframe if the *hosting* page's embed explicitly allows it. No code inside this app can grant that permission itself — it's a property of the `<iframe>` tag on the page that embeds it:
```html
<iframe src="https://your-deployed-assistant.example.com" allow="microphone" title="GCE-TLY AI Assistant"></iframe>
```
Without `allow="microphone"` on that tag, voice input will correctly show the "permission denied" state — that's the browser's iframe security model, not a bug in this code.

## 6. Free live web search — what happens
Ollama remains local and free, while the server performs a no-key DuckDuckGo HTML lookup for questions containing words like "latest," "current," "2026-27," "notification," "deadline," or role-holder questions like "who is the principal" (see `needsCurrentInfo()` in `lib/retrieval.ts`). Explicit requests to "search the web" or "verify this live" also trigger the lookup. Search results are labeled separately from the curated local knowledge base and cached for 30 minutes. DuckDuckGo is an external public service, so no provider can honestly promise permanent availability.

**Stop generating:** the send button becomes a Stop button while streaming. Clicking it aborts the fetch client-side, which Next.js surfaces as the request's `AbortSignal` firing server-side too, which in turn cancels the in-flight Ollama request — not just a UI-level "give up listening" that leaves generation running server-side in the background.

## 7. What's real vs. what's a documented limitation

**Real and verified:**
- 22 hand-curated knowledge entries + 36 FAQ entries (12 with real Tamil variations), built from ~12 pages actually fetched from gcetly.ac.in, each with a source URL and last-checked date
- TF-IDF keyword retrieval engine, unit-tested with 59 passing tests including three real bugs caught and fixed during development
- Hallucination control: zero-retrieval queries get the exact spec-mandated fallback sentence, never an invented answer
- Session isolation: structural, not policy-based (see architecture section above)
- Every source `.ts`/`.tsx` file passes syntax validation (esbuild transpile check)

**Honest limitations:**
- I don't have a standing connection to gcetly.ac.in from my own environment — the ~12 pages behind the curated knowledge base were fetched directly while building this, not by running the crawler script live. The crawler code itself is complete and was validated as thoroughly as possible without live network access (its HTML-extraction and incremental-caching logic mirrors an earlier Python crawler that WAS validated against synthetic HTML in this same conversation); running it for real against the live site, on a machine with internet access, is the way to extend coverage beyond the ~12 pages already included.
- `npm install` / `next build` / `next dev` were not run end-to-end in my environment (no network access there either) — every file was syntax-checked individually and the core retrieval/language/prompt logic was actually executed and tested (see `npm test` output above), but a full Next.js build was not performed. Standard Next.js 14 App Router conventions were followed throughout.
- Keyword retrieval (not semantic/vector search) means paraphrases with zero shared vocabulary can miss — e.g. "how do I get in" without any of "admission/apply/join" won't retrieve well. The FAQ `variations` arrays exist specifically to cover the phrasings people actually use; add more as you observe real queries missing.
- Thumbs up/down feedback is local UI state only (no backend persistence) — intentional, to avoid storing any conversation content server-side, consistent with the privacy requirements in the spec.

## 8. Production deployment

**Since v3.1, "works on any Node.js host" comes with a real caveat: Ollama needs to run alongside it.** See the ⚠️ warning near the top of this README before picking a host — Vercel specifically cannot run Ollama itself.
- Self-hosted (Railway, Fly.io, a VPS, a college server) with Ollama on the same machine is the simplest, most coherent option and what this README assumes by default.
- `OLLAMA_HOST`/`OLLAMA_MODEL` are the only LLM-related env vars now — no API key to protect.
- The in-memory rate limiter (`lib/rateLimit.ts`) resets if the process restarts and doesn't share state across multiple instances/regions. Fine for a single instance; swap in Upstash Redis (already wired in, see `.env.example`) if you scale horizontally.
- Re-run `npm run crawl && npm run update-knowledge` periodically (a cron job, GitHub Action, or your host's scheduled-task feature) to keep `data/gcetly-knowledge.auto.json` current, then redeploy or restart so `lib/knowledgeStore.ts` picks up the change (it already re-reads if the file's mtime changed, without needing a full rebuild). The `.github/workflows/recrawl.yml` automation already does this daily if you're using GitHub for source control.

## 9. Project structure

```
app/
  page.tsx, layout.tsx, globals.css
  api/chat/route.ts          Main chat endpoint (streaming, stateless, grounded)
  api/session/new/route.ts   Issues a fresh session id (rate-limit bucket only)
  api/health/route.ts        Health check -- reports whether Ollama is reachable and the model is pulled
  api/feedback/route.ts      Persists thumbs up/down ratings via lib/feedbackStore.ts
  api/admin/feedback/route.ts  Token-gated read access to feedback data
  admin/page.tsx              Read-only feedback dashboard (needs ADMIN_ACCESS_TOKEN set)
components/
  ChatWindow.tsx              Main state + streaming + new-chat reset + voice input + local history + edit/resend
  Header.tsx                  Letterhead branding, new chat, export, language toggle, dark mode
  CollegeLogo.tsx              The real official logo, with graceful fallback
  MessageBubble.tsx           Copy/regenerate/feedback/speak, source citations, edit affordance, follow-up chips
  QuickActions.tsx            The 12 quick-action buttons from the spec
  MarkdownLite.tsx            Dependency-free markdown rendering
lib/
  types.ts                    Shared types
  language.ts                 English/Tamil/mixed detection
  knowledgeStore.ts            Loads + merges curated/auto knowledge, FAQ (server-only, fs)
  retrieval.ts                  TF-IDF retrieval + intent detection + multi-site priority weighting
  systemPrompt.ts                Grounding rules, source-authority tiers, honest no-web-search disclosures
  retryLogic.ts                   Pure retry/backoff decision logic (dependency-free, unit-tested)
  ollama.ts                        Local Ollama streaming client -- retry/backoff/timeout, no web search
  rateLimit.ts                      Swappable rate limiter -- in-memory default, optional Upstash Redis
  feedbackStore.ts                   Swappable feedback storage -- local file default, optional Upstash Redis
  useVoiceInput.ts                  Voice state machine (idle/requesting/listening/processing/error)
  urlSafety.ts                      Citation URL validation (dependency-free, unit-tested)
  followUps.ts                       Rule-based suggested next questions (dependency-free, unit-tested)
  localHistory.ts                    Persistent local chat history, parsing separated for testability
  exportChat.ts                      Conversation -> Markdown export
  chatClient.ts                       Browser-side SSE consumption + duplicate-send guard (client-only)
data/
  gcetly-knowledge.json        Hand-curated, verified knowledge base
  gcetly-faq.json               Curated FAQ with EN+TA phrasing variations
  gcetly-knowledge.auto.json     Generated by update-knowledge.ts (gitignored initially)
  feedback/                       feedback-log.jsonl, gitignored -- local-file fallback only (see lib/feedbackStore.ts)
public/
  manifest.json                PWA manifest
scripts/
  crawlerCore.ts                Multi-site crawl utilities (fetch, extract, robots.txt, storage, trust tiers)
  crawl-gcetly.ts                 CLI: crawl the configured site(s)
  update-knowledge.ts               CLI: regenerate the auto knowledge base from a crawl
.github/workflows/
  recrawl.yml                   Scheduled recrawl -- now gated by `npm test` before it commits anything
tests/
  test-questions.ts             114 tests, zero external deps -- all genuinely verified passing by
  running them. categories, Tamil, typos, ambiguity, hallucination control, greeting regression,
  memory isolation, retry/backoff, deep research, current-info triggers, citation safety, source
  titles, follow-ups, local-history parsing, Markdown export, priority weighting
  test-crawler.ts                extractContent/isAllowed coverage for the multi-site crawler --
  requires cheerio, which could NOT be verified by execution in the sandbox this was written in
  (no network access to install it). Run `npm test` yourself for a real result on this one.
```

## 10. Environment variables

See `.env.example`:
```
OLLAMA_HOST=http://localhost:11434   # where Ollama is running -- change if it's on another machine
OLLAMA_MODEL=qwen3:8b                # must match a model you've actually "ollama pull"ed
RATE_LIMIT_PER_MINUTE=20
UPSTASH_REDIS_REST_URL=   # optional -- see lib/rateLimit.ts. Leave blank to keep the default in-memory limiter.
UPSTASH_REDIS_REST_TOKEN= # optional, pairs with the URL above -- also used by lib/feedbackStore.ts if set
ADMIN_ACCESS_TOKEN=       # optional -- enables /admin. Unset = /admin refuses everything, never "open"
```

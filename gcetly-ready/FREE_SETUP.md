# Zero-money setup (efficient)

## Provider switch (permanent vs free cloud)

| Mode | When | Env |
|------|------|-----|
| **Ollama (permanent)** | College/your PC | `LLM_PROVIDER=ollama` |
| **OpenRouter (demo)** | Vercel, no PC | `LLM_PROVIDER=openrouter` + API key |

If OpenRouter free ends, set `LLM_PROVIDER=ollama` again — same app, no rewrite.


Everything here is **free**. No API bills, no paid GPU.

## 1. Use a small model (biggest win)

```bash
ollama pull qwen2.5:3b
# alternatives: phi3:mini  |  qwen2.5:1.5b
```

In `.env.local`:

```bash
OLLAMA_MODEL=qwen2.5:3b
FREE_MODE=1
OLLAMA_KEEP_ALIVE=30m
```

| Model | RAM (approx) | Speed on CPU | Quality for college FAQ |
|-------|----------------|--------------|-------------------------|
| qwen2.5:1.5b | ~2–3 GB | Fastest | OK for short facts |
| **qwen2.5:3b** | ~3–5 GB | Good | **Recommended free default** |
| qwen3:8b | ~6–10 GB | Slower | Better language, needs more RAM |

## 2. Run only what you need

```bash
# Terminal 1 — leave on
ollama serve

# Terminal 2
cd gcetly-full
cp .env.example .env.local   # already has FREE_MODE=1
npm install
npm run dev
```

Warm once (optional, still free):

```bash
curl -X POST http://localhost:3000/api/warm
```

## 3. What FREE_MODE does (no cost)

- Smaller context (`num_ctx` ~2048)
- Shorter answers (`num_predict` ~256)
- Fewer retrieved docs (4 instead of 6)
- Shorter chat history sent to the model
- Fewer automatic web searches (only time-sensitive / weak local match)
- Small-talk still answered with **zero** model calls

## 4. Hosting with ₹0

| Option | How |
|--------|-----|
| Your old PC / lab PC | Leave it on; students use phone browser on same Wi‑Fi |
| College computer centre | Ask IT to run Docker Compose on one always-on machine |
| Laptop only when needed | Start Ollama + `npm start` when you need the bot |

You **cannot** get a free always-on GPU cloud forever. For ₹0, an **always-on spare PC** or **college lab machine** is the path.

## 5. Skip paid extras

- Leave `BRAVE_API_KEY` empty → free DuckDuckGo fallback (used less in FREE_MODE)
- Leave Upstash empty → SQLite / memory (fine on one machine)
- Do not deploy the model to Vercel (won’t work); host Ollama where the PC is

## 6. Efficiency habits

1. Prefer **FAQ / knowledge base** answers (already grounded — model only rephrases)
2. Keep knowledge JSON curated so retrieval hits **high confidence** → fewer refusals and less search
3. After boot: `curl -X POST http://localhost:3000/api/warm`
4. Set `OLLAMA_NUM_THREAD` to your **physical** CPU cores (e.g. 4 or 8)

## 7. Expected experience

- First answer after idle: a few seconds (model load) if not warmed
- Later answers on 3B CPU: often usable for short college Q&A
- Not as fluent as paid GPT — good enough for **fees, courses, contact, hostel** facts when KB has them

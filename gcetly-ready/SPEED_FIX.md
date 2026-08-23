# Speed fix — 3+ minute answers

## Root causes found

1. **"principal" triggered live web search** every time (30s–3min on slow network)
2. **Query expansion** mapped `principal` → `head`, ranking ECE HOD FAQ first
3. Cold **Ollama** + large context without FREE_MODE

## Fixes in code

- Web search only for true "latest/current/notice" cues
- FAQ ranking uses **question text** primarily
- `principal` no longer expands to `head`
- **FAQ fast path**: high-score FAQ answers without calling the LLM
- Tighter Ollama ctx/predict timeouts

## Your local `.env.local` (required)

```bash
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:3b
FREE_MODE=1
FAQ_FAST_PATH=1
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=1536
OLLAMA_NUM_PREDICT=180
OLLAMA_TIMEOUT_MS=45000
```

## Before testing

```bash
# Terminal 1
ollama serve
ollama pull qwen2.5:3b

# Warm once
curl -X POST http://localhost:3000/api/warm

# Terminal 2
npm run dev
```

Ask: **who is the principal**  
Expected: **Dr. P. Latha** in under ~1 second (FAQ fast path).

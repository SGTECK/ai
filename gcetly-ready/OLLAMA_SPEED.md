# Ollama performance (laptop)

## Best defaults
- Model: **qwen2.5:3b** (not 7B/8B on weak CPU)
- FREE_MODE=1
- FAQ_FAST_PATH=1 (many answers skip Ollama)
- keep_alive=30m + POST /api/warm once

## Commands
```bash
ollama serve
ollama pull qwen2.5:3b
ollama ps          # see loaded models
curl -X POST http://localhost:3000/api/warm
```

## Windows tips
- Close heavy browser tabs during demo
- Plug in power (avoid battery throttle)
- Do not run 8B and 3B at the same time
- `ollama stop qwen3:8b` if an old large model is loaded

## Env speed profile
```
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:3b
FREE_MODE=1
FAQ_FAST_PATH=1
OLLAMA_NUM_CTX=1024
OLLAMA_NUM_PREDICT=128
OLLAMA_NUM_THREAD=4
OLLAMA_KEEP_ALIVE=30m
VECTOR_RETRIEVAL=0
```

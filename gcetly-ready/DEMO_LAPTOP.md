# A — Laptop demo (staff approval)

## 1. Install once

```bash
# Node 18+ from https://nodejs.org
# Ollama from https://ollama.com

cd gcetly-ready   # or your project folder
npm install
ollama pull qwen2.5:3b
```

## 2. Configure

```bash
cp .env.example .env.local
```

`.env.local`:

```bash
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
FREE_MODE=1
```

## 3. Run (two terminals)

```bash
# Terminal 1
ollama serve

# Terminal 2
npm run dev
```

Open **http://localhost:3000**

## 4. Live questions

1. What courses does GCE Tirunelveli offer?
2. Hostel facilities and fees?
3. How do I contact the college?
4. Who is the principal?
5. Something unrelated (should refuse / send to website)

## 5. Say to staff

> Answers come from college knowledge, not random guessing. Long-term we can host this on the college server with Ollama at no API cost.

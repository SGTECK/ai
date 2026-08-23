# GCE-TLY AI Assistant — Final product

## What it is
Official-style college FAQ chatbot for Government College of Engineering, Tirunelveli.
Grounded answers · Fast FAQs · Local Ollama (free) · Optional staff admin.

## Quick start (Windows)
1. Install Ollama: https://ollama.com/download
2. Terminal A:
   ```
   ollama serve
   ollama pull qwen2.5:3b
   ```
3. Terminal B:
   ```
   cd gcetly-ready
   npm install
   copy .env.example .env.local
   ```
4. In `.env.local` set:
   ```
   LLM_PROVIDER=ollama
   OLLAMA_MODEL=qwen2.5:3b
   FREE_MODE=1
   FAQ_FAST_PATH=1
   OLLAMA_KEEP_ALIVE=30m
   VECTOR_RETRIEVAL=0
   ```
5. `npm run dev` → http://localhost:3000

## Demo questions
| Question | Expect |
|----------|--------|
| who is the principal | Dr. P. Latha |
| fee structure | Rs. 10,810 and category table |
| hostel fee | Rs. 14,350 |

## Optional
- Admin: set `ADMIN_ACCESS_TOKEN` → http://localhost:3000/admin
- Warm model: `curl -X POST http://localhost:3000/api/warm`
- E2E: `npx playwright install chromium && npm run test:e2e`

## Important
Answers are for guidance. Confirm high-stakes decisions on **gcetly.ac.in**.

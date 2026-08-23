# Deploy GCE-TLY AI Assistant → GitHub + Vercel + OpenRouter

## 1. Push to GitHub

On your computer (in the project folder):

```bash
cd gcetly-full   # or gcetly-nextjs

git init
git add .
git status   # confirm .env.local is NOT listed

git commit -m "GCE-TLY AI Assistant — OpenRouter + Ollama providers"

# Create empty repo on GitHub, then:
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gcetly-ai-assistant.git
git push -u origin main
```

Never commit `.env.local` (already in `.gitignore`).

---

## 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. **Import** your GitHub repo
3. Framework: **Next.js** (auto-detected)
4. Before deploy, open **Environment Variables** and add:

| Name | Value | Notes |
|------|--------|--------|
| `LLM_PROVIDER` | `openrouter` | Use cloud model |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | From openrouter.ai/keys |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it:free` | Exact free slug |
| `FREE_MODE` | `1` | Shorter, cheaper replies |
| `OPENROUTER_SITE_URL` | `https://your-app.vercel.app` | Optional |
| `OPENROUTER_APP_NAME` | `GCE-TLY AI Assistant` | Optional |

5. Click **Deploy**
6. Open the `.vercel.app` URL and test chat

---

## 3. OpenRouter checklist

- [ ] Account at https://openrouter.ai  
- [ ] API key created  
- [ ] Model id exactly: `google/gemma-4-31b-it:free` (or current free Gemma slug)  
- [ ] Key only in Vercel env — not in GitHub  

If free model is busy/rate-limited, try another free slug from  
https://openrouter.ai/models?q=free  

---

## 4. If something fails

| Error | Fix |
|-------|-----|
| 401 from OpenRouter | Wrong/missing `OPENROUTER_API_KEY` |
| 404 model | Wrong `OPENROUTER_MODEL` slug |
| 429 | Free rate limit — wait or other free model |
| Chat timeout | Hobby plan limits; keep `FREE_MODE=1` |
| Build fails on SQLite | App should still build; local db unused on Vercel |

---

## 5. Later: permanent path (no OpenRouter)

On college PC:

```bash
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:3b
npm run build && npm start
```

Same repo — only env changes.

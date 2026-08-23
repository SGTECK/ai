# Security notes (anti–vibe-code checklist)

Issues called out in typical "AI shipped vulnerable apps" critiques — and how this project handles them:

| Risk | Mitigation in this repo |
|------|-------------------------|
| Secrets in source | Keys only via env (`.env.local` / Vercel). `.gitignore` blocks `.env*` |
| No input validation | `lib/requestSecurity.ts` sanitizes message + history; length limits |
| No auth on admin | `ADMIN_ACCESS_TOKEN` + timing-safe compare (`lib/adminAuth.ts`) |
| Open warm/CPU abuse | `/api/warm` requires admin in production |
| Missing headers | `middleware.ts` sets CSP, frame deny, nosniff, referrer policy |
| Prompt injection via history | History roles/content validated; only user/assistant strings kept |
| Rate abuse | Session rate limit on `/api/chat` |
| Hallucinated answers | Retrieval grounding + refusal when confidence is none |

## Your duties when deploying

1. Never commit `OPENROUTER_API_KEY` or `ADMIN_ACCESS_TOKEN`
2. Set `ADMIN_ACCESS_TOKEN` in production
3. Prefer college Ollama for permanence; treat OpenRouter free as temporary
4. Keep knowledge base updated from official sources

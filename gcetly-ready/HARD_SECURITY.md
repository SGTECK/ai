# Hard security checklist — GCE-TLY AI Assistant

## Already enforced in code

| Control | Where |
|---------|--------|
| No secrets in repo | `.gitignore` blocks `.env.local` |
| Admin Bearer + timing-safe compare | `lib/adminAuth.ts` |
| Admin deny if token unset | admin routes |
| Chat input sanitize + length | `lib/requestSecurity.ts` |
| History role whitelist | `sanitizeHistory` |
| JSON Content-Type required | chat + feedback |
| Session + IP rate limits | `/api/chat` |
| Feedback IP rate limit | `/api/feedback` |
| Warm endpoint locked in production | `/api/warm` |
| Safe citation URLs only | `lib/urlSafety.ts` |
| Security headers + CSP + HSTS | `middleware.ts` |
| Prompt-injection resistance instructions | `lib/systemPrompt.ts` |
| Grounded answers / refuse when empty | chat route + retrieval |

## You must set in production

```bash
ADMIN_ACCESS_TOKEN=<32+ random bytes hex>
# Optional cloud demo only:
OPENROUTER_API_KEY=...
# Never commit either
```

Generate token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Deploy rules

1. HTTPS only (Vercel or reverse proxy)
2. Keys only in host env / Vercel dashboard
3. Do not expose Ollama port to the public internet
4. Prefer campus LAN for college-server pilot
5. Rotate keys if pasted in chat or screenshots

## Not in scope (college pilot)

- Full user accounts / OAuth (optional later)
- WAF / Cloudflare Bot Fight (IT can add)
- Penetration test report (ask IT after pilot)
'''


## Content-Security-Policy (strict)

- Production: no `unsafe-eval`; `frame-src 'none'`; `object-src 'none'`
- Development: allows eval + localhost WS for Next.js HMR
- `style-src` still needs `unsafe-inline` (Next/Tailwind without nonce pipeline)
- Test with `CSP_REPORT_ONLY=1` before enforcing experimental tighter policies

## Strix-style map — remediation status (complete pass)

| Finding | Status |
|---------|--------|
| Secrets in repo | Mitigated (gitignore + env only) |
| Admin without auth | Fixed (`adminAuth`) |
| Warm abuse | Fixed (admin in prod) |
| No rate limit | Fixed (chat session+IP, feedback, session) |
| Oversized / junk input | Fixed (`requestSecurity`) |
| History role injection | Fixed |
| Missing Content-Type | Fixed |
| XSS javascript: links | Fixed (`urlSafety`) |
| SSRF via citations | Fixed (block private hosts) |
| Clickjacking | Fixed (CSP + X-Frame-Options) |
| MIME sniffing | Fixed |
| HSTS | Fixed (HTTPS) |
| Weak CSP | Fixed (strict prod CSP; no unsafe-eval) |
| Health info disclosure | Fixed (minimal prod payload) |
| Markdown XSS | Fixed (HTML escape in MarkdownLite) |
| X-Powered-By | Fixed (`poweredByHeader: false`) |
| Error secret leakage | Fixed (`safeErrors` helper available) |
| Remote Ollama SSRF misconfig | Fixed (localhost-only in prod) |
| Session endpoint abuse | Fixed (IP rate limit) |
| npm audit / WAF / OAuth | Ops / out of scope for pilot |

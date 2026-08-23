# E2E (Playwright)

## Product note
There is **no** signup, login, payment, or logout.
| Requested journey | Mapped test |
|-------------------|-------------|
| Signup | Anonymous session (`/api/session/new`) on first visit |
| Login | Admin Bearer token (`admin.spec.ts`) |
| Core action | Send chat message / FAQ |
| Payment | Not applicable |
| Logout | **New Chat** clears UI thread |

## Local
```bash
npm install
npx playwright install chromium
npm run dev   # optional if webServer starts it
npm run test:e2e
```

## CI
See `.github/workflows/e2e.yml`.

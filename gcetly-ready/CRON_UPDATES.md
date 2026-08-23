# Scheduled knowledge updates (Phase H)

## Weekly (recommended on college server)

```cron
# Sunday 03:00 — crawl official sources then rebuild knowledge JSON
0 3 * * 0 cd /opt/gcetly-ready && npm run crawl:recommended && npm run knowledge:refresh
```

## After crawl

1. Review `data/` outputs / diffs
2. Optional: admin re-check sensitive fees/dates
3. Restart `npm start` or wait for knowledgeStore mtime reload

## Safety

- Prefer official domains only (`crawl:recommended`)
- Never auto-merge random web into production without review
- Keep `ADMIN_ACCESS_TOKEN` set for document uploads

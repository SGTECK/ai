# Advanced RAG features

## Vector DB (local)
- SQLite table `chunk_embeddings`
- Embeddings from **Ollama** `nomic-embed-text`
```bash
ollama pull nomic-embed-text
```
- Hybrid: BM25 + cosine merge (`lib/hybridRetrieve.ts`)

## OCR / PDF
- PDF text: `pdftotext` (poppler-utils) when installed
- Images: `tesseract` CLI (`eng+tam` if available)
```bash
# Debian/Ubuntu examples
sudo apt install poppler-utils tesseract-ocr tesseract-ocr-tam
```

## Admin pipeline
1. `/admin` → Upload pipeline (multi-file)
2. Documents → Approve · extract · chunk · embed
3. Preview chunks on verified docs

## Analytics
- `analytics_events` table (truncated query kinds)
- Admin → Analytics tab

## Crawl scale
- Seeds: `data/crawl-seeds.txt`
- `npm run crawl:recommended` then `npm run knowledge:refresh`
- True 1000-page corpus needs long crawl windows + review; quality > raw count

## Live campus events
- Seed event chunk in knowledge JSON
- Time-sensitive questions still use gated web search

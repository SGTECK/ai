#!/usr/bin/env bash
# One-shot setup for GCE-TLY AI Assistant
set -euo pipefail

echo "==> GCE-TLY AI Assistant setup"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed. Install from https://nodejs.org (18.17+ / 22 recommended)."
  exit 1
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"
echo ""

echo "==> Running: npm install"
npm install
echo ""

if [ ! -f .env.local ]; then
  if [ -f .env.example ]; then
    cp .env.example .env.local
    echo "==> Created .env.local from .env.example"
    echo "    Edit .env.local: set LLM_PROVIDER=ollama and OLLAMA_MODEL=qwen2.5:3b"
  fi
else
  echo "==> .env.local already exists (left unchanged)"
fi

echo ""
echo "==> Setup complete."
echo ""
echo "Next steps:"
echo "  1. ollama serve          # other terminal"
echo "  2. ollama pull qwen2.5:3b"
echo "  3. npm run dev"
echo "  4. Open http://localhost:3000"
echo ""

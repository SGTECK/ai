#!/usr/bin/env bash
# GCE-TLY AI Assistant Production Launcher for Linux / Ubuntu Server

set -e

echo "==================================================="
echo "  GCE-TLY AI Assistant - Linux Server Launcher"
echo "==================================================="

# 1. Check Ollama service
if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "[1/3] Starting Ollama in background..."
    ollama serve >/dev/null 2>&1 &
    sleep 3
else
    echo "[1/3] Ollama is active."
fi

# 2. Warm model
echo "[2/3] Warming AI model..."
ollama run qwen2.5:3b "ping" >/dev/null 2>&1 || true

# 3. Start Next.js
echo "[3/3] Starting Web Server on http://0.0.0.0:3000..."
npm run start -- -p 3000 -H 0.0.0.0

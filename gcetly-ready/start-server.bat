@echo off
title GCE-TLY AI Assistant Production Server
echo ===================================================
echo   GCE-TLY AI Assistant - College Server Launcher
echo ===================================================
echo.

:: 1. Check if Ollama is running
curl.exe -s http://localhost:11434/api/tags >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [1/3] Starting Ollama server in background...
    start /B ollama serve
    timeout /t 3 /nobreak >nul
) else (
    echo [1/3] Ollama server is active.
)

:: 2. Warm up the model in RAM
echo [2/3] Warming up AI model in RAM (zero cold-starts)...
ollama run qwen2.5:3b "ping" >nul 2>&1

:: 3. Start Next.js server
echo [3/3] Starting GCE-TLY Chatbot on http://localhost:3000...
echo.
echo ===================================================
echo   Server is running! Access via LAN / Localhost
echo   URL: http://localhost:3000
echo   Admin Panel: http://localhost:3000/admin
echo ===================================================
echo.

node node_modules\next\dist\bin\next start -p 3000 -H 0.0.0.0

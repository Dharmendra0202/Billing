@echo off
title Bill AI Editor - 100%% FREE Local AI
color 0A

echo ========================================
echo    Bill AI Editor - 100%% FREE
echo ========================================
echo.
echo Starting Ollama (FREE local AI)...
echo.

REM Start Ollama in background
start /B "Ollama" "C:\Users\Dharmendra\AppData\Local\Programs\Ollama\ollama.exe" serve

REM Wait a moment for Ollama to start
timeout /t 3 /nobreak >nul

echo Ollama is running!
echo.
echo Starting your bill editor...
echo.
echo The app will open in your browser.
echo Keep this window open while using the app.
echo.
echo To stop: Close this window
echo.

REM Start the app
npm run dev

pause

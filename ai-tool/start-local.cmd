@echo off
chcp 65001 >nul
title WhatsApp Debt Checker
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install it from nodejs.org then run this again. & pause & exit /b 1)
if not exist node_modules\@anthropic-ai\sdk (echo First run: installing... & call npm install --omit=dev --no-audit --no-fund || (pause & exit /b 1))
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node local\server.mjs
pause

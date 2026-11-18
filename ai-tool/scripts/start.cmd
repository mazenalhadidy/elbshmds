@echo off
rem ============================================================
rem  WhatsApp debt checker - double-click to start.
rem  First time: Notepad opens the settings; write the password and the Claude key, save, close.
rem  Needs only Node.js (the same one the shop program uses). No installation.
rem ============================================================
cd /d "%~dp0"
title WhatsApp Debt Checker
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if exist "%~dp0..\node\node.exe" set "PATH=%~dp0..\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from nodejs.org, then run this file again.
  pause
  exit /b 1
)
if not exist local\config.json (
  copy local\config.example.json local\config.json >nul
  echo First run: write the password and anthropicApiKey in Notepad, save, then close Notepad.
  notepad local\config.json
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node local\server.mjs
pause

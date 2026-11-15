@echo off
rem ============================================================
rem  Double-click me: starts the shop program and opens it in the browser.
rem  The first time it asks for your settings (.env) and installs what it needs.
rem  Keep this window open while the shop works (or use autostart-install.cmd).
rem ============================================================
cd /d "%~dp0"
title Elbashmohandes shop
rem portable Node.js (no installation) can live in a "node" folder next to this file
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Read docs\SETUP-WINDOWS.md step 1, then run this file again.
  pause
  exit /b
)
if not exist .env (
  copy .env.example .env >nul
  echo First run: fill in the settings in Notepad, save, then close Notepad.
  notepad .env
)
if exist data\stop.flag del data\stop.flag
node scripts\updater.js --open
pause

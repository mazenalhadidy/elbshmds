@echo off
rem Drag the WhatsApp chat (.zip, .txt or .md) onto this file: every phone number in it becomes a wallet with balance 0.
rem The shop program must be running.
cd /d "%~dp0"
title Add wallets
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if "%~1"=="" (
  echo Drag the WhatsApp chat file ^(.zip or .txt^) onto add-wallets.cmd
  pause
  exit /b
)
node scripts\import-wallets.mjs %*
pause

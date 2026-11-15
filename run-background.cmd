@echo off
rem Runs the shop program quietly and starts it again if it stops (used by autostart-install.cmd).
cd /d "%~dp0"
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"
if not exist .env (
  echo The settings file .env is missing. Run start-shop.cmd once first.
  pause
  exit /b
)
if exist data\stop.flag del data\stop.flag
:loop
node scripts\updater.js
if exist data\stop.flag exit /b
timeout /t 5 /nobreak >nul
goto loop

@echo off
rem ============================================================
rem  Double-click me: starts the shop server and opens the app.
rem  (Settings come from the .env file in this folder.)
rem ============================================================
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo First run: a settings file was created. Fill in the values, save it, then close Notepad.
  notepad .env
)
if not exist node_modules (
  echo Installing, please wait...
  call npm install
)
rem open the browser 3 seconds from now (in a separate hidden window), then run the server here
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
node --watch src/server.js
pause

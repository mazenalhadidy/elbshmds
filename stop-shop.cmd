@echo off
rem Stops the shop program (the launcher and the server it started).
cd /d "%~dp0"
if not exist data\launcher.pid (
  echo The program is not running.
  pause
  exit /b
)
echo stop> data\stop.flag
set /p PID=<data\launcher.pid
taskkill /PID %PID% /T /F
del data\launcher.pid
pause

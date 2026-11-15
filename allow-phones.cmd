@echo off
rem ============================================================
rem  Lets phones on the SAME Wi-Fi open the program (fixes "phone cannot load the page").
rem  Windows Firewall blocks it by default. Run this ONCE: right-click -> Run as administrator.
rem  Only devices on your local network are allowed (not the internet).
rem ============================================================
net session >nul 2>&1
if errorlevel 1 (
  echo Please right-click this file and choose "Run as administrator".
  pause
  exit /b
)
netsh advfirewall firewall delete rule name="Elbashmohandes shop" >nul 2>&1
netsh advfirewall firewall add rule name="Elbashmohandes shop" dir=in action=allow protocol=TCP localport=3000 remoteip=localsubnet profile=any
echo.
echo Done. On the phone open the address shown in the program (Management page), for example http://192.168.1.10:3000
pause

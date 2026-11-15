@echo off
rem Stops the program from starting automatically at log in.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Elbashmohandes shop.lnk" 2>nul
echo Done.
pause

@echo off
rem Run ONCE: the program starts by itself (minimized) every time you log in to Windows.
cd /d "%~dp0"
set "V=%temp%\elb-startup.vbs"
> "%V%" echo Set s = CreateObject("WScript.Shell")
>> "%V%" echo Set l = s.CreateShortcut(s.SpecialFolders("Startup") ^& "\Elbashmohandes shop.lnk")
>> "%V%" echo l.TargetPath = "%~dp0run-background.cmd"
>> "%V%" echo l.WorkingDirectory = "%~dp0"
>> "%V%" echo l.WindowStyle = 7
>> "%V%" echo l.Save
cscript //nologo "%V%"
del "%V%"
echo Done. The program will start by itself when you log in to Windows.
echo Open it any time at http://localhost:3000
pause

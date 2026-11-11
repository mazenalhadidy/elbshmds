@echo off
rem Run this ONCE: it puts a "Shop Elbashmohandes" icon on your Desktop that starts the app.
cd /d "%~dp0"
set "V=%temp%\mkshortcut.vbs"
> "%V%" echo Set s = CreateObject("WScript.Shell")
>> "%V%" echo d = s.SpecialFolders("Desktop")
>> "%V%" echo Set l = s.CreateShortcut(d ^& "\Shop Elbashmohandes.lnk")
>> "%V%" echo l.TargetPath = "%~dp0start-shop.cmd"
>> "%V%" echo l.WorkingDirectory = "%~dp0"
>> "%V%" echo l.IconLocation = "%SystemRoot%\System32\shell32.dll,13"
>> "%V%" echo l.Save
cscript //nologo "%V%"
del "%V%"
echo Done. Look for "Shop Elbashmohandes" on your Desktop.
pause

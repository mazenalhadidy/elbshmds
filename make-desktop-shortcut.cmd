@echo off
rem Run ONCE: puts an icon on the Desktop that opens the program.
cd /d "%~dp0"
set "V=%temp%\elb-desktop.vbs"
> "%V%" echo Set s = CreateObject("WScript.Shell")
>> "%V%" echo Set l = s.CreateShortcut(s.SpecialFolders("Desktop") ^& "\Elbashmohandes shop.lnk")
>> "%V%" echo l.TargetPath = "%~dp0start-shop.cmd"
>> "%V%" echo l.WorkingDirectory = "%~dp0"
>> "%V%" echo l.IconLocation = "%SystemRoot%\System32\shell32.dll,13"
>> "%V%" echo l.Save
cscript //nologo "%V%"
del "%V%"
echo Done. Look for "Elbashmohandes shop" on your Desktop.
pause

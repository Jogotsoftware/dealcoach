@echo off
set SCRIPT=%TEMP%\create_dc_shortcut.vbs
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%SCRIPT%"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\DealCoach.lnk" >> "%SCRIPT%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%SCRIPT%"
echo oLink.TargetPath = "%~dp0node_modules\.bin\electron.cmd" >> "%SCRIPT%"
echo oLink.Arguments = "." >> "%SCRIPT%"
echo oLink.WorkingDirectory = "%~dp0" >> "%SCRIPT%"
echo oLink.IconLocation = "%~dp0icon.png" >> "%SCRIPT%"
echo oLink.Description = "DealCoach Desktop" >> "%SCRIPT%"
echo oLink.Save >> "%SCRIPT%"
cscript //nologo "%SCRIPT%"
del "%SCRIPT%"
echo Desktop shortcut created!

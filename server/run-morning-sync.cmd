@echo off
setlocal
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
"C:\Program Files\nodejs\node.exe" "%~dp0morning-sync.mjs" >> "logs\task-scheduler.log" 2>&1
endlocal

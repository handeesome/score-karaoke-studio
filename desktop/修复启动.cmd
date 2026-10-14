@echo off
setlocal
set "PUJIAN_REPAIR_ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $taskRoot=[IO.Path]::GetFullPath($env:PUJIAN_REPAIR_ROOT); if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'Pujian.exe')) -or -not (Test-Path -LiteralPath (Join-Path $taskRoot '_internal/pythonnet/runtime/Python.Runtime.dll'))) { throw 'Place this repair file beside Pujian.exe in the extracted Pujian folder.' }; Get-ChildItem -LiteralPath $taskRoot -File -Recurse | Unblock-File; Write-Host 'Download marks removed. Run Pujian.exe again.'"
if errorlevel 1 echo Repair failed. Please keep the error message above.
pause
endlocal

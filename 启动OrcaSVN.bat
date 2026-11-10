@echo off
setlocal

set "ORCA_EXE=%~dp0src-tauri\target\debug\OrcaSVN.exe"

if not exist "%ORCA_EXE%" (
    echo OrcaSVN.exe was not found:
    echo "%ORCA_EXE%"
    echo.
    echo Build it from the project directory with:
    echo npm run tauri -- build --debug --no-bundle
    echo.
    pause
    exit /b 1
)

start "" /D "%~dp0" "%ORCA_EXE%"
endlocal

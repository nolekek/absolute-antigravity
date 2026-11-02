@echo off
setlocal
echo [Antigravity v3.0] Registering agy-daemon startup task...
set SCRIPT_DIR=%~dp0
set VBS_PATH=%SCRIPT_DIR%autostart_daemon.vbs
schtasks /create /tn "AntigravityDaemon" /tr "wscript.exe \"%VBS_PATH%\"" /sc onlogon /f >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Task AntigravityDaemon registered successfully in Windows Task Scheduler (on logon).
) else (
    echo [Notice] Could not register via schtasks (needs admin). Adding to Startup folder...
    set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
    copy /y "%VBS_PATH%" "%STARTUP_DIR%\autostart_agy_daemon.vbs" >nul
    echo [OK] Created autostart entry in Startup folder.
)

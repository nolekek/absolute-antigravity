@echo off
rem ==============================================================================
rem Absolute Antigravity: Remote Web Dashboard Launcher (Windows)
rem ==============================================================================
setlocal EnableDelayedExpansion

set SCRIPT_DIR=%~dp0
set DASHBOARD_SCRIPT=%SCRIPT_DIR%server_dashboard.js

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js 18+ to run the Antigravity Web Dashboard.
    exit /b 1
)

set IS_DAEMON=0
set FORWARD_ARGS=

:parse_args
if "%~1"=="" goto after_parse
if /I "%~1"=="--daemon" (
    set IS_DAEMON=1
) else if /I "%~1"=="-d" (
    set IS_DAEMON=1
) else (
    set FORWARD_ARGS=%FORWARD_ARGS% %1
)
shift
goto parse_args

:after_parse
if %IS_DAEMON%==1 (
    echo [INFO] Launching Antigravity Web Dashboard in background...
    set PID_DIR=%USERPROFILE%\.gemini\antigravity
    if not exist "!PID_DIR!" mkdir "!PID_DIR!"
    set LOG_FILE=!PID_DIR!\web.log
    
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$proc = Start-Process node -ArgumentList '\"%DASHBOARD_SCRIPT%\" %FORWARD_ARGS%' -PassThru -WindowStyle Hidden -RedirectStandardOutput '!LOG_FILE!' -RedirectStandardError '!LOG_FILE!'; Set-Content -Path '!PID_DIR!\web.pid' -Value $proc.Id; Write-Host ('[SUCCESS] Web Dashboard started in background (PID: ' + $proc.Id + ')') -ForegroundColor Green"
    echo Logs: !LOG_FILE!
) else (
    node "%DASHBOARD_SCRIPT%" %FORWARD_ARGS%
)

endlocal

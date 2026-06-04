@echo off
setlocal

chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "CHECK_ONLY=0"
if /I "%~1"=="--check" set "CHECK_ONLY=1"

title Mission Web Dev

echo.
echo [start-web-dev] Starting frontend development server.
echo [start-web-dev] Project: %CD%
echo [start-web-dev] Web: http://localhost:5173
echo.

call :require_command node "Node.js"
if errorlevel 1 goto fail

call :require_command npm "npm"
if errorlevel 1 goto fail

if "%CHECK_ONLY%"=="1" (
  echo [start-web-dev] Check passed. Node.js and npm are available.
  goto done
)

call :ensure_dependencies
if errorlevel 1 goto fail

echo [start-web-dev] Press Ctrl+C to stop.
echo.
call npm run dev:web
if errorlevel 1 goto fail
goto done

:ensure_dependencies
if not exist "node_modules" (
  echo [start-web-dev] node_modules is missing. Installing dependencies first...
  call npm install
  if errorlevel 1 exit /b 1
  echo.
)
exit /b 0

:require_command
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [start-web-dev] ERROR: %~2 was not found in PATH.
  echo [start-web-dev] Please install %~2 and reopen this launcher.
  exit /b 1
)
exit /b 0

:fail
echo.
echo [start-web-dev] Startup failed.
pause
exit /b 1

:done
endlocal

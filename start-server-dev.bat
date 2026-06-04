@echo off
setlocal

chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "CHECK_ONLY=0"
if /I "%~1"=="--check" set "CHECK_ONLY=1"

if "%PORT%"=="" set "PORT=3100"

title Mission Server Dev

echo.
echo [start-server-dev] Starting backend development server.
echo [start-server-dev] Project: %CD%
echo [start-server-dev] API: http://localhost:%PORT%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [start-server-dev] ERROR: Node.js was not found in PATH.
  echo [start-server-dev] Please install Node.js and reopen this launcher.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [start-server-dev] ERROR: npm was not found in PATH.
  echo [start-server-dev] Please install npm and reopen this launcher.
  goto fail
)

if "%CHECK_ONLY%"=="1" (
  echo [start-server-dev] Check passed. Node.js and npm are available.
  goto done
)

if not exist "node_modules" (
  echo [start-server-dev] node_modules is missing. Installing dependencies first...
  call npm install
  if errorlevel 1 goto fail
  echo.
)

echo [start-server-dev] Press Ctrl+C to stop.
echo.
call npm run dev:server
if errorlevel 1 goto fail
goto done

:fail
echo.
echo [start-server-dev] Startup failed.
pause
exit /b 1

:done
endlocal

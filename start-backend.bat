@echo off
setlocal

chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "MODE=%~1"
set "CHECK_ONLY=0"
if /I "%MODE%"=="--check" (
  set "CHECK_ONLY=1"
  set "MODE="
)

if "%PORT%"=="" set "PORT=3100"

title Mission Backend Launcher

echo.
echo [start-backend] Mission backend launcher
echo [start-backend] Project: %CD%
echo.

call :require_command node "Node.js"
if errorlevel 1 goto fail

call :require_command npm "npm"
if errorlevel 1 goto fail

if not exist "package.json" (
  echo [start-backend] ERROR: package.json was not found. Run this file from the project root.
  goto fail
)

if "%CHECK_ONLY%"=="1" (
  echo [start-backend] Check passed. Node.js and npm are available.
  goto done
)

if not exist "node_modules" (
  echo [start-backend] node_modules is missing. Installing dependencies first...
  call npm install
  if errorlevel 1 goto fail
  echo.
)

if /I "%MODE%"=="dev" (
  echo [start-backend] Starting development backend with file watch...
  echo [start-backend] API address: http://localhost:%PORT%
  echo [start-backend] Press Ctrl+C to stop.
  echo.
  call npm run dev:server
  if errorlevel 1 goto fail
  goto done
)

if not "%MODE%"=="" (
  echo [start-backend] Unknown mode: %MODE%
  echo [start-backend] Usage:
  echo [start-backend]   start-backend.bat
  echo [start-backend]   start-backend.bat dev
  echo [start-backend]   start-backend.bat --check
  goto fail
)

echo [start-backend] Starting local production backend...
echo [start-backend] App address: http://localhost:%PORT%
echo [start-backend] The launcher will reuse apps/dist/client when it exists.
echo [start-backend] Press Ctrl+C to stop.
echo.
call npm run start
if errorlevel 1 goto fail
goto done

:require_command
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [start-backend] ERROR: %~2 was not found in PATH.
  echo [start-backend] Please install %~2 and reopen this launcher.
  exit /b 1
)
exit /b 0

:fail
echo.
echo [start-backend] Startup failed.
pause
exit /b 1

:done
endlocal

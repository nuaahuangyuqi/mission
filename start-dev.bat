@echo off
setlocal

chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "CHECK_ONLY=0"
if /I "%~1"=="--check" set "CHECK_ONLY=1"

if "%PORT%"=="" set "PORT=3100"

title Mission Dev Stack

echo.
echo [start-dev] Starting full development stack.
echo [start-dev] Project: %CD%
echo [start-dev] Web: http://localhost:5173
echo [start-dev] API: http://localhost:%PORT%
echo.

call :require_command node "Node.js"
if errorlevel 1 goto fail

call :require_command npm "npm"
if errorlevel 1 goto fail

if "%CHECK_ONLY%"=="1" (
  echo [start-dev] Check passed. Node.js and npm are available.
  goto done
)

call :ensure_dependencies
if errorlevel 1 goto fail

echo [start-dev] Press Ctrl+C to stop.
echo.
call npm run dev
if errorlevel 1 goto fail
goto done

:ensure_dependencies
if not exist "node_modules" (
  echo [start-dev] node_modules is missing. Installing dependencies first...
  call npm install
  if errorlevel 1 exit /b 1
  echo.
)
exit /b 0

:require_command
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [start-dev] ERROR: %~2 was not found in PATH.
  echo [start-dev] Please install %~2 and reopen this launcher.
  exit /b 1
)
exit /b 0

:fail
echo.
echo [start-dev] Startup failed.
pause
exit /b 1

:done
endlocal

@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Stella] Node.js not found. Install the LTS version from https://nodejs.org and run again.
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo [Stella] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm.cmd start

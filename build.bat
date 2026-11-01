@echo off
cd /d "%~dp0"
if not exist node_modules\electron-builder (
  call npm.cmd install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm.cmd run dist
echo.
echo [Stella] Installer: dist\Stella-Setup-*.exe
pause

@echo off
REM ============================================================
REM  Double-click this to refresh the app with new clothes.
REM  Same as running:  python tools\update-catalog.py
REM  Anything you type after it is passed through, e.g.
REM      update.bat --quick
REM      update.bat --shops 30 --push
REM ============================================================
cd /d "%~dp0"
python tools\update-catalog.py %*
echo.
echo Press any key to close...
pause >nul

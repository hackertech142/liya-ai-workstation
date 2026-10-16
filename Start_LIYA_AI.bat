@echo off
title LIYA AI Assistant Launcher
color 0A
echo ========================================================
echo               LIYA AI ASSISTANT LAUNCHER
echo ========================================================
echo.
echo [1/3] Starting LIYA Backend Server...
start "LIYA Backend Server" /min cmd /k "cd /d "%~dp0backend" && npm run dev"

echo [2/3] Starting LIYA Frontend Server...
start "LIYA Frontend Server" /min cmd /k "cd /d "%~dp0" && npm run dev"

echo [3/3] Waiting for servers to initialize...
timeout /t 4 /nobreak >nul

echo.
echo Opening LIYA AI Assistant in your default browser...
start http://localhost:5173

echo.
echo ========================================================
echo   LIYA AI Assistant is now running successfully!
echo   Browser opened: http://localhost:5173
echo ========================================================
echo.
echo Note: Do not close the minimized server windows while using the application.
echo.
pause

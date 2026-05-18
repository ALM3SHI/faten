@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo.
echo ==============================================================
echo       UQU Full Stack - Starting Backend and Frontend        
echo ==============================================================
echo.

cd /d "%~dp0"

echo Activating virtual environment and starting Backend...
start "UQU Backend" cmd /k "call .venv\Scripts\activate.bat && cd backend && python -m uvicorn main:app --reload --port 8000"

echo Starting Frontend...
start "UQU Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ==============================================================
echo       Servers are starting...                             
echo                                                            
echo       Frontend: http://localhost:3000                    
echo       API Docs: http://localhost:8000/docs               
echo                                                            
echo       Opening browser in 5 seconds...                     
echo ==============================================================
echo.

:: Wait 5 seconds
timeout /t 5 /nobreak > nul

:: Open browser
start http://localhost:3000

echo Servers are running!
echo You can close the newly opened terminal windows to stop the servers.
echo.
pause

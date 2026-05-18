@echo off
REM UQU Navigation Engine - Simple Restart Script for Windows
REM Just double-click this file to restart the backend

echo.
echo ════════════════════════════════════════════════════════════════
echo  UQU Navigation Engine - Restart Backend
echo ════════════════════════════════════════════════════════════════
echo.

cd /d "c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade"

echo [1/3] Activating Python environment...
call .venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment
    pause
    exit /b 1
)

cd backend

echo [2/3] Running tests...
python setup_and_test.py
if errorlevel 1 (
    echo WARNING: Tests failed but continuing...
)

echo.
echo [3/3] Starting Backend Server...
echo.
echo ════════════════════════════════════════════════════════════════
echo Server will run on: http://localhost:8000
echo Swagger UI: http://localhost:8000/docs
echo Press Ctrl+C to stop
echo ════════════════════════════════════════════════════════════════
echo.

uvicorn main:app --reload --port 8000

pause

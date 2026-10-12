import os

bat_content = """@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo.
echo ==============================================================
echo       UQU Full Stack - Starting Backend and Frontend        
echo ==============================================================
echo.

cd /d "%~dp0"

echo Activating virtual environment and starting Backend...
start "UQU Backend" cmd /k "call .venv\\Scripts\\activate.bat && cd backend && python -m uvicorn main:app --reload --port 8000"

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
"""

ps1_content = """# UQU Full Stack Starter + Auto-Open Browser
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootPath

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "      UQU Full Stack - Starting Backend & Frontend        " -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Starting Backend..." -ForegroundColor Yellow
$BackendProcess = Start-Process -PassThru -WindowStyle Normal -FilePath "cmd.exe" -ArgumentList "/k `"call .venv\Scripts\activate.bat && cd backend && python -m uvicorn main:app --reload --port 8000`""

Write-Host "Starting Frontend..." -ForegroundColor Yellow
$FrontendProcess = Start-Process -PassThru -WindowStyle Normal -FilePath "cmd.exe" -ArgumentList "/k `"cd frontend && npm run dev`""

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "      Servers are starting...                             " -ForegroundColor Green
Write-Host "                                                            " -ForegroundColor Green
Write-Host "      Frontend: http://localhost:3000                    " -ForegroundColor Green
Write-Host "      API Docs: http://localhost:8000/docs               " -ForegroundColor Green
Write-Host "                                                            " -ForegroundColor Green
Write-Host "      Opening browser in 5 seconds...                     " -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Write-Host ""

# Wait 5 seconds
Start-Sleep -Seconds 5

# Open browser
Write-Host "Opening browser..." -ForegroundColor Cyan
Start-Process "http://localhost:3000"

Write-Host "Servers are running!" -ForegroundColor Green
Write-Host "You can close the newly opened terminal windows to stop the servers." -ForegroundColor Yellow
Write-Host ""
"""

# Write bat file with explicit CRLF
with open(r"c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade\RUN_SERVER.bat", "wb") as f:
    f.write(bat_content.replace('\n', '\r\n').encode('utf-8'))

# Write ps1 file with explicit CRLF
with open(r"c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade\RUN_SERVER.ps1", "wb") as f:
    f.write(ps1_content.replace('\n', '\r\n').encode('utf-8'))

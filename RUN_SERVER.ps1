# UQU Full Stack Starter + Auto-Open Browser
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force

$RootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootPath

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "      UQU Full Stack - Starting Backend & Frontend        " -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Starting Backend..." -ForegroundColor Yellow
$BackendProcess = Start-Process -PassThru -WindowStyle Normal -FilePath "cmd.exe" -ArgumentList "/k `"call .venv\Scriptsctivate.bat && cd backend && python -m uvicorn main:app --reload --port 8000`""

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

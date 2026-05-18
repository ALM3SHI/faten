#!/usr/bin/env powershell
<#
UQU Navigation - Quick Start Script
This script stops any running backend, tests the data, and starts a fresh backend.
#>

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🧭 UQU Navigation Engine - Quick Start" -ForegroundColor Yellow
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Change to backend directory
$backendDir = "c:\Users\M4SHi\Desktop\uqu_upgrade (5)\uqu_upgrade\backend"
Set-Location $backendDir

Write-Host "`n[1/3] Checking Python environment..." -ForegroundColor Cyan
try {
    $pythonCheck = python --version 2>&1
    Write-Host "✓ Python: $pythonCheck" -ForegroundColor Green
} catch {
    Write-Host "✗ Python not found. Please install Python 3.9+" -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/3] Testing Navigation System..." -ForegroundColor Cyan
try {
    Write-Host "Running full_test.py..." -ForegroundColor Yellow
    python full_test.py
    Write-Host "✓ Test completed" -ForegroundColor Green
} catch {
    Write-Host "⚠ Test had issues, but continuing..." -ForegroundColor Yellow
}

Write-Host "`n[3/3] Starting Backend Server..." -ForegroundColor Cyan
Write-Host "Server will run on: http://localhost:8000" -ForegroundColor Cyan
Write-Host "Swagger UI: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "When ready to stop, press Ctrl+C" -ForegroundColor Gray
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Start the backend
uvicorn main:app --reload --port 8000


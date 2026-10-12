@echo off
chcp 65001 > nul
setlocal

echo.
echo ==============================================================
echo       UQU Full Stack - Starting Backend (WSL) and Frontend
echo ==============================================================
echo.

cd /d "%~dp0"

:: ---------- Pre-flight checks ----------
where wsl > nul 2>&1
if errorlevel 1 (
    echo [ERROR] WSL is not installed. Run:  wsl --install -d Ubuntu
    goto :fail
)
if not exist "backend\.env" (
    echo [ERROR] backend\.env is missing.
    echo         Copy backend\.env.example to backend\.env and fill in your keys.
    goto :fail
)
if not exist "backend\serviceAccountKey.json" (
    echo [ERROR] backend\serviceAccountKey.json is missing.
    echo         Firebase Console ^> Project Settings ^> Service Accounts ^>
    echo         Generate New Private Key, then save it as backend\serviceAccountKey.json
    goto :fail
)

:: ---------- First-run setup: Python venv inside WSL ----------
:: The backend runs in WSL because Windows Smart App Control blocks the
:: unsigned grpc DLL that Firestore needs. The venv lives in the Linux
:: home folder (~/faten-venv), not in this OneDrive folder.
wsl --cd "%~dp0backend" -- bash -lc "test -f ~/faten-venv/bin/activate"
if errorlevel 1 (
    echo Creating Python environment in WSL ^(~/faten-venv^) ...
    wsl --cd "%~dp0backend" -- bash -lc "python3 -m venv ~/faten-venv && source ~/faten-venv/bin/activate && pip install -r requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Could not set up the WSL environment.
        echo         If venv is missing, run inside Ubuntu:  sudo apt install -y python3-venv
        goto :fail
    )
)

:: ---------- First-run setup: frontend packages ----------
if not exist "frontend\node_modules\next" (
    echo Installing frontend packages ...
    pushd frontend
    call npm ci
    if errorlevel 1 (
        popd
        goto :fail
    )
    popd
)

echo Starting Backend in WSL...
:: WATCHFILES_FORCE_POLLING: edits made from Windows to /mnt/c files do not
:: raise Linux file events, so --reload must poll to notice them.
start "UQU Backend" wsl --cd "%~dp0backend" -- bash -lc "source ~/faten-venv/bin/activate && WATCHFILES_FORCE_POLLING=true python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"

echo Starting Frontend...
start "UQU Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ==============================================================
echo       Frontend: http://localhost:3000
echo       API Docs: http://localhost:8000/docs
echo       Opening browser in 8 seconds...
echo ==============================================================
echo.

timeout /t 8 /nobreak > nul
start http://localhost:3000
echo Servers are running. Close their windows to stop them.
echo.
pause
exit /b 0

:fail
echo.
echo Setup stopped. Fix the problem above and run this file again.
pause
exit /b 1

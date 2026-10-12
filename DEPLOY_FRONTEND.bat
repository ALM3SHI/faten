@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

echo.
echo ==============================================================
echo       Faten - Build and deploy frontend + Firestore rules
echo ==============================================================
echo.

if not exist "frontend\.env.production.local" (
    echo [ERROR] frontend\.env.production.local is missing.
    echo         Create it with one line:
    echo         NEXT_PUBLIC_AGENT_BASE_URL=https://YOUR-BACKEND.onrender.com
    goto :fail
)

echo Building static site ...
pushd frontend
call npm run build
if errorlevel 1 (
    popd
    goto :fail
)
popd

echo Deploying to Firebase Hosting ...
:: First time only: run  npx firebase-tools login
call npx --yes firebase-tools deploy --only hosting,firestore:rules
if errorlevel 1 goto :fail

echo.
echo Done:  https://fatenai.web.app
pause
exit /b 0

:fail
echo.
echo Deploy stopped. Fix the problem above and run this file again.
pause
exit /b 1

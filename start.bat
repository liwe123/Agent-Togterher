@echo off
title Agent Console

echo.
echo   ==========================================
echo   |    Agent Console - Multi-Agent Desk    |
echo   ==========================================
echo.

:: Check .env
if not exist ".env" (
    echo [1/3] Creating .env from .env.example ...
    copy .env.example .env >nul
    echo       Done. Edit .env to add API keys if needed.
) else (
    echo [1/3] .env already exists, skipping
)

:: Check Docker
where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker not found. Please install Docker Desktop first.
    echo         https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: Start
echo [2/3] Starting services (first build takes 2-5 min) ...
docker compose up --build -d

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Startup failed. Check that Docker is running.
    pause
    exit /b 1
)

:: Wait for healthy
echo [3/3] Waiting for services to become ready ...
:wait
timeout /t 3 /nobreak >nul
curl -s http://localhost:8000/api/v1/health >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto wait

echo.
echo   ==========================================
echo   |  Ready!                                |
echo   |                                       |
echo   |  Frontend : http://localhost:3000     |
echo   |  API Docs : http://localhost:8000/docs |
echo   |                                       |
echo   |  Press any key to open the browser... |
echo   ==========================================
pause >nul
start http://localhost:3000

echo.
echo   Stop:   docker compose down
echo   Logs:   docker compose logs -f
echo.
pause

@echo off
title Agent Console (Local Hybrid)
setlocal enabledelayedexpansion

echo.
echo   ==========================================
echo   |   Agent Console - Local Hybrid Mode    |
echo   |   db/redis in Docker, backend/frontend |
echo   |   on host (Codex CLI reachable)        |
echo   ==========================================
echo.

:: ---- Config: override Python interpreter via PYTHON_BIN env var ----
if "%PYTHON_BIN%"=="" (
    if exist "backend\.venv\Scripts\python.exe" (
        set "PYTHON_BIN=backend\.venv\Scripts\python.exe"
    ) else (
        set "PYTHON_BIN=python"
    )
)
:: Resolve PYTHON_BIN to an absolute path so it survives `cd backend` later.
for %%I in ("%PYTHON_BIN%") do set "PYTHON_BIN=%%~fI"
echo   Using Python: %PYTHON_BIN%

:: ---- [1/6] .env ----
if not exist ".env" (
    echo [1/6] Creating .env from .env.example ...
    copy .env.example .env >nul
) else (
    echo [1/6] .env already exists, skipping
)

:: ---- [2/6] Infrastructure (Docker optional) ----
where docker >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [2/6] Docker found - starting db + redis containers ...
    docker compose up -d db redis
    if !ERRORLEVEL! NEQ 0 (
        echo [WARN] docker compose failed, falling back to SQLite
        set "DB_URL=sqlite+aiosqlite:///./data/agent_console.db"
        set "REDIS_URL=redis://localhost:6379/0"
        goto :deps
    )
    set "DB_URL=postgresql+asyncpg://agent:agent@localhost:5432/agent_console"
    set "REDIS_URL=redis://localhost:6379/0"
    echo       Waiting for db to become healthy ...
    set /a _dbwait=0
    :waitdb
    timeout /t 2 /nobreak >nul
    docker compose ps db 2>nul | findstr "healthy" >nul
    if !ERRORLEVEL! EQU 0 goto :dbok
    set /a _dbwait+=1
    if !_dbwait! LSS 60 goto :waitdb
    echo [WARN] db not healthy after 120s, continuing anyway
    goto :dbdone
    :dbok
    echo       db is healthy
    :dbdone
) else (
    echo [2/6] Docker not found - using SQLite ^(no PG/Redis^)
    set "DB_URL=sqlite+aiosqlite:///./data/agent_console.db"
    set "REDIS_URL=redis://localhost:6379/0"
)

:: ---- [3/6] Check backend deps ----
:deps
echo [3/6] Checking backend dependencies ...
"%PYTHON_BIN%" -c "import fastapi, uvicorn, sqlalchemy" 2>nul
if !ERRORLEVEL! NEQ 0 (
    echo [ERROR] Backend dependencies missing.
    echo         Install them first:
    echo           cd backend ^&^& "%PYTHON_BIN%" -m pip install -r requirements.txt
    pause
    exit /b 1
)
echo       Dependencies OK

:: ---- [4/6] Codex CLI reachability (the whole point of hybrid mode) ----
echo [4/6] Checking Codex CLI on host ...
where codex >nul 2>&1
if !ERRORLEVEL! EQU 0 (
    echo       Codex CLI found:
    for /f "delims=" %%v in ('codex --version 2^>nul') do echo         %%v
) else (
    echo [WARN] Codex CLI not found on host PATH.
    echo        Install: npm install -g @openai/codex
    echo        Dispatch to codex nodes will fail until installed.
)

:: ---- [5/6] Start backend on host ----
echo [5/6] Starting backend on host :8000 ...
set "DATABASE_URL=%DB_URL%"
set "MODELS_CONFIG_PATH=../config/models.yaml"
start "Agent Console - Backend" /D backend cmd /k ""%PYTHON_BIN%" -m uvicorn app.main:app --reload --port 8000"

echo       Waiting for backend health ...
set /a _apiwait=0
:waitapi
timeout /t 2 /nobreak >nul
curl -s http://localhost:8000/api/v1/health >nul 2>&1
if !ERRORLEVEL! EQU 0 goto :apiok
set /a _apiwait+=1
if !_apiwait! LSS 60 goto :waitapi
echo [ERROR] backend not healthy after 120s - check the Backend window
goto :apidone
:apiok
echo       Backend is healthy
:apidone

:: ---- [6/6] Start frontend on host ----
echo [6/6] Starting frontend on host :3000 ...
if not exist "frontend\node_modules" (
    echo [ERROR] frontend/node_modules not found. Run: cd frontend ^&^& npm install
    pause
    exit /b 1
)
start "Agent Console - Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo   ==========================================
echo   |  Ready! (Local Hybrid Mode)            |
echo   |                                        |
echo   |  Frontend : http://localhost:3000      |
echo   |  API Docs : http://localhost:8000/docs |
echo   |                                        |
echo   |  Codex node dispatch now works because |
echo   |  the backend runs on the host where    |
echo   |  the Codex CLI is installed.           |
echo   |                                        |
echo   |  Stop: close the Backend/Frontend       |
echo   |  windows, then "docker compose down"   |
echo   ==========================================
echo.
pause

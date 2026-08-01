@echo off
chcp 65001 >nul
title Agent Console

echo.
echo   ╔══════════════════════════════════════╗
echo   ║     Agent Console · 多智能体协同台   ║
echo   ╚══════════════════════════════════════╝
echo.

:: Check .env
if not exist ".env" (
    echo [1/3] 初始化 .env 配置文件...
    copy .env.example .env >nul
    echo       已从 .env.example 创建 .env（如需 API Key 请编辑此文件）
) else (
    echo [1/3] .env 已存在，跳过
)

:: Check Docker
where docker >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 未找到 Docker，请先安装 Docker Desktop
    echo       下载: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: Start
echo [2/3] 启动服务（首次需构建镜像，约 2-5 分钟）...
docker compose up --build -d

if %ERRORLEVEL% NEQ 0 (
    echo [错误] 启动失败，请检查 Docker 是否正常运行
    pause
    exit /b 1
)

:: Wait for healthy
echo [3/3] 等待服务就绪...
:wait
timeout /t 3 /nobreak >nul
curl -s http://localhost:8000/api/v1/health >nul 2>&1
if %ERRORLEVEL% NEQ 0 goto wait

echo.
echo   ┌──────────────────────────────────────────┐
echo   │  启动完成！                               │
echo   │                                          │
echo   │  前端:   http://localhost:3000            │
echo   │  API:    http://localhost:8000/docs        │
echo   │  健康:   http://localhost:8000/api/v1/health │
echo   │                                          │
echo   │  按任意键打开前端页面...                    │
echo   └──────────────────────────────────────────┘
pause >nul
start http://localhost:3000

echo.
echo   停止服务: docker compose down
echo   查看日志: docker compose logs -f
echo.
pause

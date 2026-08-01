$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Agent Console"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗"
Write-Host "  ║     Agent Console · 多智能体协同台   ║"
Write-Host "  ╚══════════════════════════════════════╝"
Write-Host ""

# Check .env
if (-not (Test-Path ".env")) {
    Write-Host "[1/3] 初始化 .env 配置文件..."
    Copy-Item .env.example .env
    Write-Host "      已从 .env.example 创建 .env（如需 API Key 请编辑此文件）"
} else {
    Write-Host "[1/3] .env 已存在，跳过"
}

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[错误] 未找到 Docker，请先安装 Docker Desktop"
    Write-Host "      下载: https://www.docker.com/products/docker-desktop"
    pause
    exit 1
}

# Start
Write-Host "[2/3] 启动服务（首次需构建镜像，约 2-5 分钟）..."
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 启动失败，请检查 Docker 是否正常运行"
    pause
    exit 1
}

# Wait for healthy
Write-Host "[3/3] 等待服务就绪..."
do {
    Start-Sleep -Seconds 3
    try { $null = Invoke-WebRequest -Uri "http://localhost:8000/api/v1/health" -TimeoutSec 2 -ErrorAction SilentlyContinue }
    catch { }
} until ($?)

Write-Host ""
Write-Host "  ┌──────────────────────────────────────────┐"
Write-Host "  │  启动完成！                               │"
Write-Host "  │                                          │"
Write-Host "  │  前端:   http://localhost:3000            │"
Write-Host "  │  API:    http://localhost:8000/docs        │"
Write-Host "  │  健康:   http://localhost:8000/api/v1/health │"
Write-Host "  │                                          │"
Write-Host "  │  按任意键打开前端页面...                    │"
Write-Host "  └──────────────────────────────────────────┘"
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "  停止服务: docker compose down"
Write-Host "  查看日志: docker compose logs -f"
Write-Host ""
pause

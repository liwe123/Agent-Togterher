$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Agent Console"

Write-Host ""
Write-Host "  =========================================="
Write-Host "  |    Agent Console - Multi-Agent Desk    |"
Write-Host "  =========================================="
Write-Host ""

# Check .env
if (-not (Test-Path ".env")) {
    Write-Host "[1/3] Creating .env from .env.example ..."
    Copy-Item .env.example .env
    Write-Host "      Done. Edit .env to add API keys if needed."
} else {
    Write-Host "[1/3] .env already exists, skipping"
}

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Docker not found. Please install Docker Desktop first."
    Write-Host "        https://www.docker.com/products/docker-desktop"
    pause
    exit 1
}

# Start
Write-Host "[2/3] Starting services (first build takes 2-5 min) ..."
docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Startup failed. Check that Docker is running."
    pause
    exit 1
}

# Wait for healthy
Write-Host "[3/3] Waiting for services to become ready ..."
do {
    Start-Sleep -Seconds 3
    try { $null = Invoke-WebRequest -Uri "http://localhost:8000/api/v1/health" -TimeoutSec 2 -ErrorAction SilentlyContinue }
    catch { }
} until ($?)

Write-Host ""
Write-Host "  =========================================="
Write-Host "  |  Ready!                                |"
Write-Host "  |                                       |"
Write-Host "  |  Frontend : http://localhost:3000     |"
Write-Host "  |  API Docs : http://localhost:8000/docs |"
Write-Host "  |                                       |"
Write-Host "  |  Press any key to open the browser... |"
Write-Host "  =========================================="
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "  Stop:   docker compose down"
Write-Host "  Logs:   docker compose logs -f"
Write-Host ""
pause

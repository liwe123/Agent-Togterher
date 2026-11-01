<#
.SYNOPSIS
    Agent Console 本地 CI 等价门禁：一条命令跑完 CI 的检查项。

.DESCRIPTION
    复刻 .github/workflows/python-package-conda.yml 的检查项与参数，在本地按序执行，
    让“本地绿、CI 红”的差异在提交前就暴露。对应关系：

        后端 flake8 第一遍（E9,F63,F7,F82 致命项）  <- build-linux / test-postgres 的 Lint with flake8
        后端 flake8 第二遍（复杂度 10 / 行宽 127）  <- build-linux 的 Lint with flake8（test-postgres 无此遍）
        后端 pytest tests -q                        <- build-linux 的 Test with pytest
        前端 npm test / typecheck / lint / build    <- test-frontend 的全部四步
        -WithPostgres 的 PG 全量                    <- test-postgres 的 Test with pytest on PostgreSQL

    依赖版本：CI 用 backend/constraints.txt 锁定；本地默认使用仓库内 .venv，
    可用环境变量 CI_LOCAL_PYTHON 指向别的解释器（需已装 requirements-dev.txt 全部依赖）。

    全程只读执行，不做任何 git 写操作（不 add / commit / push）。

.PARAMETER SkipTests
    跳过后端全量 pytest（保留两遍 flake8 与前端四门），用于快速迭代。
    注意：本开关只跳过 SQLite 全量；若同时给了 -WithPostgres，PG 门禁仍会执行（显式指定优先）。

.PARAMETER WithPostgres
    额外跑 PostgreSQL 模式全量 pytest，参数与 CI 的 test-postgres 一致。
    DSN 取自环境变量 TEST_PG_DATABASE_URL，例如：
        postgresql+asyncpg://postgres:postgres@localhost:5432/agent_console_test
    未提供 DSN 时直接报错退出（不静默跳过），因为 PG 是本仓库的正式门禁之一。

.EXAMPLE
    pwsh -NoProfile -File scripts/ci-local.ps1

.NOTES
    兼容性：同时兼容 PowerShell 7（pwsh）与 Windows PowerShell 5.1 —— 不使用
    ?? / 三元运算符等 PS7-only 语法；文件保存为 UTF-8 with BOM，因为 5.1 在中文
    系统上会按 GBK 读取无 BOM 的 .ps1 而导致解析失败。两种宿主下行为一致。

.EXAMPLE
    pwsh -NoProfile -File scripts/ci-local.ps1 -SkipTests

.EXAMPLE
    $env:TEST_PG_DATABASE_URL = 'postgresql+asyncpg://postgres:postgres@localhost:5432/agent_console_test'
    pwsh -NoProfile -File scripts/ci-local.ps1 -WithPostgres -SkipTests
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$WithPostgres
)

$ErrorActionPreference = 'Stop'
# 中文输出在 Windows 控制台需要显式 UTF-8，否则摘要会是乱码。
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$BackendDir  = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'

# 与验证环境一致的默认解释器；CI_LOCAL_PYTHON 可覆盖。
$Python = if ($env:CI_LOCAL_PYTHON) { $env:CI_LOCAL_PYTHON } else { Join-Path $RepoRoot '.venv\Scripts\python.exe' }

$script:Results = [System.Collections.Generic.List[object]]::new()
$script:Failed  = 0

function Add-Skipped {
    param([string]$Name, [string]$Why)
    Write-Host ''
    Write-Host ("- {0}：跳过（{1}）" -f $Name, $Why) -ForegroundColor DarkYellow
    $script:Results.Add([pscustomobject]@{ Step = $Name; Result = 'SKIP'; Seconds = 0.0 })
}

function Invoke-Gate {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$WorkDir,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    Write-Host ''
    Write-Host (">> {0}" -f $Name) -ForegroundColor Cyan
    Write-Host ("  目录: {0}" -f $WorkDir) -ForegroundColor DarkGray

    $sw   = [System.Diagnostics.Stopwatch]::StartNew()
    $code = 0
    $pushed = $false

    try {
        Push-Location -LiteralPath $WorkDir
        $pushed = $true
        & $Action
        $code = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    }
    catch {
        # 命令不存在、目录缺失等“非退出码”型失败，同样计入失败。
        Write-Host ("  [异常] {0}" -f $_.Exception.Message) -ForegroundColor Red
        $code = 1
    }
    finally {
        if ($pushed) { Pop-Location }
        $sw.Stop()
    }

    $ok = ($code -eq 0)
    if (-not $ok) { $script:Failed++ }

    $secs  = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $label = if ($ok) { 'PASS' } else { "FAIL (exit $code)" }
    Write-Host ("  => {0}  {1}s" -f $label, $secs) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })

    $script:Results.Add([pscustomobject]@{ Step = $Name; Result = $label; Seconds = $secs })
}

# ---------------------------------------------------------------- 前置校验
Write-Host ''
Write-Host '============================================================'
Write-Host '  Agent Console - 本地 CI 等价门禁 (scripts/ci-local.ps1)'
Write-Host '============================================================'
Write-Host ("  仓库: {0}" -f $RepoRoot)
Write-Host ("  模式: SkipTests={0}  WithPostgres={1}" -f [bool]$SkipTests, [bool]$WithPostgres)

if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host ("[ERROR] 找不到 Python 解释器: {0}" -f $Python) -ForegroundColor Red
    Write-Host '        期望使用仓库内 .venv，或设置环境变量 CI_LOCAL_PYTHON 指向已装依赖的解释器。' -ForegroundColor Yellow
    exit 2
}
if (-not (Test-Path -LiteralPath $BackendDir)) {
    Write-Host ("[ERROR] 找不到 backend 目录: {0}" -f $BackendDir) -ForegroundColor Red
    exit 2
}

$pyVersion = (& $Python --version 2>&1 | Out-String).Trim()
Write-Host ("  Python: {0}  ({1})" -f $pyVersion, $Python)

if ($WithPostgres) {
    # 先验证 DSN 再开跑，避免跑完 flake8 才发现缺参数。
    if ([string]::IsNullOrWhiteSpace($env:TEST_PG_DATABASE_URL)) {
        Write-Host ''
        Write-Host '[ERROR] -WithPostgres 需要环境变量 TEST_PG_DATABASE_URL（PostgreSQL DSN）。' -ForegroundColor Red
        Write-Host '        示例（PowerShell）：' -ForegroundColor Yellow
        Write-Host '        $env:TEST_PG_DATABASE_URL = ''postgresql+asyncpg://postgres:postgres@localhost:5432/agent_console_test''' -ForegroundColor Yellow
        Write-Host '        本机可先 docker compose up -d postgres 起库。' -ForegroundColor Yellow
        exit 2
    }
    Write-Host ("  PG DSN: {0}" -f ($env:TEST_PG_DATABASE_URL -replace '://[^@]*@', '://***@'))
}

$script:Started = Get-Date

# ---------------------------------------------------------------- 后端
Invoke-Gate -Name 'backend flake8 #1（致命项 E9,F63,F7,F82）' -WorkDir $BackendDir -Action {
    & $Python -m flake8 app tests --count --select=E9,F63,F7,F82 --show-source --statistics
}

Invoke-Gate -Name 'backend flake8 #2（复杂度<=10, 行宽<=127）' -WorkDir $BackendDir -Action {
    & $Python -m flake8 app tests --count --max-complexity=10 --max-line-length=127 --statistics
}

if ($SkipTests) {
    Add-Skipped -Name 'backend pytest（SQLite 全量）' -Why '已指定 -SkipTests'
}
else {
    Invoke-Gate -Name 'backend pytest（SQLite 全量）' -WorkDir $BackendDir -Action {
        & $Python -m pytest tests -q -s --timeout=120 --timeout-method=thread --session-timeout=900
    }
}

if ($WithPostgres) {
    # 与 CI test-postgres 同参数、同环境变量；env 只在本进程内，结束即还原。
    $prevPythonPath  = $env:PYTHONPATH
    $prevDatabaseUrl = $env:DATABASE_URL
    $env:PYTHONPATH   = $BackendDir
    $env:DATABASE_URL = $env:TEST_PG_DATABASE_URL
    try {
        Invoke-Gate -Name 'backend pytest（PostgreSQL 全量）' -WorkDir $BackendDir -Action {
            & $Python -m pytest -q -s --timeout=120 --timeout-method=thread --session-timeout=900
        }
    }
    finally {
        $env:PYTHONPATH   = $prevPythonPath
        $env:DATABASE_URL = $prevDatabaseUrl
    }
}

# ---------------------------------------------------------------- 前端
$npmCmd = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $npmCmd) {
    Write-Host ''
    Write-Host '[ERROR] 找不到 npm。CI 的 test-frontend 会跑四门，请先安装 Node 22。' -ForegroundColor Red
    $script:Failed++
    $script:Results.Add([pscustomobject]@{ Step = 'frontend（npm 缺失）'; Result = 'FAIL (no npm)'; Seconds = 0.0 })
}
elseif (-not (Test-Path -LiteralPath (Join-Path $FrontendDir 'node_modules'))) {
    Write-Host ''
    Write-Host '[ERROR] frontend/node_modules 不存在，请先执行：cd frontend; npm ci' -ForegroundColor Red
    $script:Failed++
    $script:Results.Add([pscustomobject]@{ Step = 'frontend（node_modules 缺失）'; Result = 'FAIL (no deps)'; Seconds = 0.0 })
}
else {
    Invoke-Gate -Name 'frontend npm test' -WorkDir $FrontendDir -Action { npm test }
    Invoke-Gate -Name 'frontend npm run typecheck' -WorkDir $FrontendDir -Action { npm run typecheck }
    Invoke-Gate -Name 'frontend npm run lint' -WorkDir $FrontendDir -Action { npm run lint }
    Invoke-Gate -Name 'frontend npm run build' -WorkDir $FrontendDir -Action { npm run build }
}

# ---------------------------------------------------------------- 汇总
$total = [math]::Round(((Get-Date) - $script:Started).TotalSeconds, 1)

Write-Host ''
Write-Host '============================================================'
Write-Host '  汇总'
Write-Host '============================================================'
$script:Results | Format-Table -AutoSize Step, Result, Seconds | Out-String -Width 200 | Write-Host

if ($script:Failed -eq 0) {
    Write-Host ("[CI-LOCAL] 全部通过（{0} 项，用时 {1}s）" -f $script:Results.Count, $total) -ForegroundColor Green
    exit 0
}

Write-Host ("[CI-LOCAL] 失败 {0} 项 / 共 {1} 项，用时 {2}s —— 与 CI 同参数的检查未通过，请修复后重跑。" -f $script:Failed, $script:Results.Count, $total) -ForegroundColor Red
exit 1

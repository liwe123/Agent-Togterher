# PRD：Windows 一键启动脚本

> 类型：新需求（Requirement）｜状态：已实施｜关联提交：`fb94fb2`（C-007，+ 修复 `4396cad`）

---

## 1. 背景与问题

MVP 的启动方式是手敲三条命令：

```powershell
Copy-Item .env.example .env
docker compose up --build
```

对非运维用户门槛高：需要记得复制 `.env`（漏了则缺 API Key 配置）、Docker 未安装/未启动时只会抛晦涩错误、不知道何时服务就绪、还要手动打开浏览器。README 里「一分钟跑起来」需要真正一键化。

### 本轮要解决的问题
1. 双击即启动：自动处理 `.env`、Docker 检查、服务构建与启动、就绪等待、打开浏览器。
2. 同时支持 cmd（`start.bat`）与 PowerShell（`start.ps1`）两种 shell。
3. 启动失败给出明确原因（缺 Docker / Docker 未运行 / 端口占用）。

## 2. 目标与非目标

**目标**
- G1：`start.bat` 与 `start.ps1` 一键启动完整栈（前端 3000 + 后端 8000）。
- G2：`.env` 缺失时自动从 `.env.example` 复制；已存在则跳过。
- G3：Docker 未安装时给出安装指引；`docker compose up --build -d` 失败时提示检查 Docker 是否运行。
- G4：轮询 `/api/v1/health` 直到就绪，然后打开浏览器。
- G5：脚本输出消息跨代码页安全（纯 ASCII，避免 cmd/PowerShell 按 ANSI 解析中文乱码）。

**非目标（N1-N3）**
- N1：不做安装 Docker 的自动化（引导用户装 Docker Desktop）。
- N2：不做 Linux/macOS 脚本（本轮仅 Windows；Docker Compose 本身跨平台）。
- N3：不做停止/日志管理（脚本末尾提示 `docker compose down` / `logs -f`）。

## 3. 用户故事

- US1：作为新用户，我双击 `start.bat`，看到三步进度（复制 .env → 启动服务 → 等待就绪），就绪后浏览器自动打开 http://localhost:3000。
- US2：作为用户，我本机没装 Docker——双击脚本后看到「Docker not found」与安装链接，而不是命令报错。
- US3：作为用户，我重复启动——`.env` 已存在时脚本跳过复制，直接启动服务。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 新增 `start.bat`（cmd）与 `start.ps1`（PowerShell）两个启动脚本 | P0 |
| FR2 | 自动复制 `.env.example` → `.env`（仅当 `.env` 不存在） | P0 |
| FR3 | Docker 存在性检查：`where docker` / `Get-Command docker`，缺失时提示安装 Docker Desktop 并退出 | P0 |
| FR4 | `docker compose up --build -d` 启动服务，失败时提示检查 Docker 运行状态 | P0 |
| FR5 | 健康轮询：每 3 秒 `curl`/`Invoke-WebRequest` 命中 `http://localhost:8000/api/v1/health`，直到 200 | P0 |
| FR6 | 就绪后输出前端/API 地址，等待按键后 `start http://localhost:3000` 打开浏览器 | P0 |
| FR7 | 脚本输出使用纯 ASCII 消息（4396cad 修复 UTF-8 被 ANSI 解析的中文乱码）；PowerShell 端显式设置 `[Console]::OutputEncoding = UTF8` | P1 |
| FR8 | 结尾提示停止（`docker compose down`）与日志（`docker compose logs -f`）命令 | P1 |

## 5. 非功能需求（NFR）

- **健壮**：`$ErrorActionPreference="Stop"`（PowerShell）；`if %ERRORLEVEL% NEQ 0` 退出检查（cmd）；任一失败步骤明确提示而非静默继续。
- **可读**：步骤化进度 `[1/3]`、`[2/3]`、`[3/3]`；就绪横幅显示前端与 API Docs 地址。
- **兼容**：纯 ASCII 输出保证跨代码页（GBK/UTF-8）一致显示；PowerShell 无额外依赖（仅标准 cmdlet）。
- **幂等**：重复运行不破坏 `.env`（已存在即跳过）。

## 6. 验收标准（AC）

- AC1：全新目录下双击 `start.bat` → 自动生成 `.env` → 启动服务 → 轮询就绪 → 打开 http://localhost:3000。
- AC2：`.env` 已存在时，脚本显示「already exists, skipping」且不覆盖。
- AC3：未安装 Docker 时，脚本显示明确错误与 Docker Desktop 安装链接，退出码非 0。
- AC4：`start.ps1` 在 PowerShell 下行为与 `start.bat` 一致（含就绪等待与浏览器打开）。
- AC5：在 GBK 代码页的 cmd 下运行，脚本输出无乱码（纯 ASCII）。
- AC6：Docker Compose 健康检查通过后，`http://localhost:8000/api/v1/health` 返回 200。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | start.bat（cmd 路径） | cmd 一键启动 |
| M2 | start.ps1（PowerShell 路径） | PS 一键启动 |
| M3 | 乱码修复（4396cad 纯 ASCII） | 跨代码页安全 |

## 8. 变更追踪登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 21:20 | C-007 | 已完成 | [fb94fb2](https://github.com/liwe123/Agent-Togterher/commit/fb94fb2) | LI | Requirement | 部署 | 新增 Windows 一键启动脚本 | start.bat / start.ps1 | - | 否 | 否 | - | Docker Compose 封装；自动复制 .env + 等健康 |
| 2026-08-02 23:36 | C-011 | 已完成 | [4396cad](https://github.com/liwe123/Agent-Togterher/commit/4396cad) | LI | BUG | 部署 | 修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析） | 脚本消息改纯 ASCII | - | 否 | 否 | - | 跨代码页安全 |

---

## 9. 已实施摘要（实施部分）

**关键文件**
- 新增：`start.bat`、`start.ps1`
- 参考：`docker-compose.yml`（服务编排）、`.env.example`

**验证结果**：Docker Compose 封装，`copy .env` + 健康轮询 + 自动开浏览器；4396cad 将脚本消息改纯 ASCII 修复中文乱码。

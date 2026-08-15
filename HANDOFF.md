# Agent Console 项目接力文档 (HANDOFF)

> 更新时间：2026-08-15  
> 工作目录：`E:\Agents`  
> 当前阶段：**Phase 4（产品化）进行中 — 批次 1 (A1 用户认证) 与 批次 2 (A2 RBAC 角色权限 + A3 多租户隔离) 均已完成并通过验收**

---

## 1. 架构演进与全景现状

系统已从最初的 MVP 成功演进为具备多租户隔离、RBAC 角色权限、持久化调度、独立 Worker、Redis 分布式事件总线与用户认证的工业级协同任务平台：

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 16 前端控制台                     │
│  - / (集群总览)           - /chats (多智能体群聊协作)        │
│  - /tasks (任务队列)      - /tasks/[id] (执行轨迹深度回溯)    │
│  - /contacts (通讯录)     - /settings (模型/密钥配置中心)     │
│  - /settings/members (成员与权限管理台 - 角色升降/邀请/移除) │
│  - /login (登录)          - /register (注册)                │
│  - AppSidebar 工作区切换器 (多租户无缝切换 / 创建 / 邀请加入)│
│  - AuthGuard 路由守卫     - Bearer Token 401 自动无感续期     │
└───────────────┬─────────────────────────────┬───────────────┘
                │ REST API (Bearer JWT)       │ WebSocket (?token=JWT)
                ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 核心服务集群                     │
│  - app/api/v1/endpoints (auth, workspaces, tasks, models...)│
│  - app/core/permissions.py (RBAC 角色权限矩阵与拦截依赖)     │
│  - app/core/auth.py (PBKDF2-SHA256 密码哈希 / PyJWT 签发)    │
│  - app/core/security.py (API Token 与 JWT 双轨鉴权)         │
│  - app/core/message_hub.py (@Agent 提及解析与任务生成)       │
│  - app/core/orchestrator.py (多阶段 Agent 编排流水线)        │
│  - app/services/task_service.py (任务状态机与租约管理)       │
│  - app/services/tools.py (Function Calling 安全工具集)       │
│  - app/websocket/distributed.py (Redis Pub/Sub 跨进程总线)   │
└───────────────┬─────────────────────────────┬───────────────┘
                │ AsyncSession                │ 队列轮询 / 原子 Claim
                ▼                             ▼
┌───────────────────────────────┐ ┌───────────────────────────┐
│     SQLAlchemy 数据持久层     │ │    独立 Worker 消费进程   │
│  - 13 张领域数据表            │ │  - app/worker.py          │
│  - SQLite (生产可切 PostgreSQL)│ │  - worker_concurrency 控制 │
│  - 默认工作区与 6 个预设 Agent │ │  - 租约心跳与死信重试      │
└───────────────────────────────┘ └───────────────────────────┘
```

---

## 2. 数据库表清单 (共 13 张)

| 表名 | 模块 | 核心作用 |
|---|---|---|
| `users` | 认证 | 用户账号 (`email`, `password_hash`, `display_name`, `avatar`, `is_active`, `last_login_at`) |
| `workspaces` | 租户 | 工作区与租户容器 |
| `workspace_memberships` (✨ 新增) | 权限 | 用户与工作区成员映射及角色 (`owner`, `admin`, `member`, `viewer`) |
| `workspace_invitations` (✨ 新增) | 邀请 | 工作区专属邀请码与核销状态 (`invite_code`, `role`, `expires_at`, `status`) |
| `agents` | 智能体 | 预设与自定义 Agent (`role`, `model_name`, `system_prompt`, `status`) |
| `conversations` | 聊天 | 会话容器 |
| `messages` | 消息 | 聊天消息事实记录 |
| `tasks` | 任务 | 业务任务事实源 (`status`, `result`, `execution_token`, `execution_token_expires_at`) |
| `task_steps` | 步骤 | 任务各执行阶段输入、输出与耗时 |
| `task_queue_items` | 队列 | 任务持久化调度队列 (`status`: queued/leased/completed/dead, `attempt_count`) |
| `model_calls` | 审计 | LLM 调用统计 (`prompt_tokens`, `completion_tokens`, `cost`, `latency_ms`) |
| `provider_credentials` | 密钥 | 模型厂商 API Key 存储（掩码管理） |
| `custom_model_configs` | 模型 | 自定义模型与 Fallback 容灾映射 |

---

## 3. Phase 4 进展与后续任务路线

### 已完成
- [x] **批次 1：A1 用户认证系统 (C-101)**
  - 后端：`User` 模型、`auth.py` (PBKDF2/JWT)、`/api/v1/auth` 路由、双轨认证中间件、WebSocket 握手 JWT 鉴权。
  - 前端：`/login` 与 `/register` 页面、`AuthGuard` 路由守卫、`task-api.ts` 自动注入 Bearer Token 与 401 自动续期。
- [x] **批次 2：A2 角色权限模型 (RBAC) 与 A3 多租户 Workspace 隔离 (C-103)**
  - 后端：`WorkspaceMembership` 与 `WorkspaceInvitation` 模型、`permissions.py` (4级角色权限矩阵与拦截依赖)、`workspace_members.py` (my/members/invite/join/role/remove) 路由、新用户注册自动绑定工作区。
  - 前端：`useWorkspaces` 与 `usePermissions` hooks、侧边栏工作区切换器浮层（切换/创建/加入/登出）、`/settings/members` 成员与权限管理控制台。
  - 测试：后端全量 **100 tests passed**（包含 `test_permissions.py` 与 `test_auth.py`）；前端 **28 tests passed**，`lint` (0 error, 0 warning) 与生产构建全量通过。
  - 验收：子 Agent 独立验收 APPROVED，PRD 文档与改动表对齐。

### 下一步待实施任务
- [ ] **批次 3：审计与成本中心 (B1 + C1)**
  - B1 平台级审计日志: `audit_logs` 表，记录工作区核心操作（创建任务/修改角色/更新密钥/删除成员等）并在前端 `/settings/audit` 展示。
  - C1 成本统计面板: 聚合 `model_calls` 生成按天/按模型消耗趋势、Token 统计与 Top 消耗任务排行。
- [ ] **批次 4：回放与配额 (B2 + C2)**
  - B2 任务执行回放: 在 `/tasks/[id]` 提供步进回放、上下文 Diff 与失败节点恢复重试。
  - C2 配额与限流升级: `quota_configs` 表，按工作区月度 Token/Cost 额度限制与 Redis 速率控制。
- [ ] **批次 5：插件生态 (D1)**
  - D1 插件注册中心: `plugins` 表与 Manifest 机制，支持工作区按需挂载工具扩展。
- [ ] **批次 6：工作流模板引擎 (D2)**
  - D2 工作流模板引擎: 自定义流水线编排、条件分支与人工审批节点。

---

## 4. 常用运行与测试命令

### 后端运行与测试
```powershell
Set-Location E:\Agents\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt

# 运行全量单元与集成测试 (当前 100 Passed)
python -c "import pytest, sys; sys.exit(pytest.main(['tests', '-p', 'no:warnings', '-q']))"

# 启动后端 API 服务
uvicorn app.main:app --reload --port 8000
```

### 前端运行与测试
```powershell
Set-Location E:\Agents\frontend
npm install

# 运行前端测试 (当前 28 Passed)
npm test

# 检查代码规范 (0 Error, 0 Warning)
npm run lint

# 生产环境构建编译
npm run build

# 启动开发服务器 (http://localhost:3000)
npm run dev
```

### 文档同步脚本
```powershell
# 每次 git commit 后重跑以下两命令，对齐改动表与单页阅读器：
python docs/generate_change_log.py
python docs/build_prd_html.py
```

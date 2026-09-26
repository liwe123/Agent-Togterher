# Agent Console 项目接力文档 (HANDOFF)

> 更新时间：2026-09-25  
> 工作目录：`E:\Agents`  
> 当前阶段：**Phase 5（外部接入与治理深化）进行中：PostgreSQL 已上线、外部节点桥接与配额熔断已落地、独立 Worker 与事件总线调度链路已启用（C-169~C-174）、工作区快照断线对账与事件总线容错已补齐；Phase 1 三项新能力（Webhook 插件执行器 C-183 / HITL 人工审批 C-185 / DAG 工作流引擎 C-186）已于 2026-09-04 推送（94343a2）；Batch 9+ 已落地 C2 审批收紧（C-214）、C1 Webhook 配置界面（C-217）、B8 Worker 健康探针（C-218）、B7 链路追踪字段（C-220）；2026-09-25 P0 止血批次已修恢复任务假调度、回放错误信息缺失与鉴权、test_command RCE、生产 fail-closed、DAG 孤儿运行收敛。剩余缺口以 `docs/深度审查与推进计划报告-20260925.md` 为最新基线：15 项未落地需求（REQ-A1/A5/A6/A7、B1/B2/B3/B4/B5/B6/B9、D2/D3/D4/D6）+ OPT-5 + 验收补课 E1/E2/E3。**

---

## 1. 架构演进与全景现状

系统已从最初的单体 MVP 成功演进为具备企业级多租户隔离、RBAC 细粒度权限、平台级操作审计、多维成本与 Token 治理、工作区配额与限流硬熔断、任务时序回放与断点单步调试、插件注册中心与工具热插拔、工作流模板引擎与 DAG 编排、持久化任务队列、独立 Worker 进程与分布式事件总线的全功能多智能体协同任务平台：

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 16 前端控制台                     │
│  - / (集群总览)           - /chats (多智能体群聊协作)        │
│  - /tasks (任务队列)      - /tasks/[id] (时序回放与断点调试)  │
│  - /workflows (工作流引擎) - /contacts (智能体通讯录)        │
│  - /settings (设置中心 - 5 大管理卡片响应式网格导航)         │
│  - /settings/members (成员与权限管理台 - 角色升降/邀请/移除) │
│  - /settings/audit (平台操作审计日志台 - 多维过滤/明细抽屉) │
│  - /settings/cost (成本中心与 Token 大屏 - 趋势/模型/Top榜)  │
│  - /settings/quota (工作区配额与限流大屏 - 水位指示/硬熔断)  │
│  - /settings/plugins (插件注册中心 - Manifest 检查/热插拔)   │
│  - /login (登录)          - /register (注册)                │
│  - TaskReplayPlayer (时间轴拖拽 / 1x-5x 倍速 / 断点恢复执行) │
│  - AppSidebar 工作区切换器 (多租户无缝切换 / 创建 / 邀请加入)│
│  - AuthGuard 路由守卫     - Bearer Token 401 自动无感续期     │
└───────────────┬─────────────────────────────┬───────────────┘
                │ REST API (Bearer JWT)       │ WebSocket (?token=JWT)
                ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 核心服务集群                     │
│  - app/api/v1/endpoints (auth, members, audit, cost, quota, │
│                         replay, plugins, workflows...)      │
│  - app/services/quota_service.py (配额计算与超额熔断服务)    │
│  - app/services/audit_service.py (全局异步审计埋点服务)      │
│  - app/core/permissions.py (RBAC 角色权限矩阵与拦截依赖)     │
│  - app/core/auth.py (PBKDF2-SHA256 密码哈希 / PyJWT 签发)    │
│  - app/core/security.py (API Token 与 JWT 双轨鉴权)         │
│  - app/core/message_hub.py (@Agent 提及解析与任务生成)       │
│  - app/core/orchestrator.py (多阶段 Agent 编排流水线)        │
│  - app/services/task_service.py (任务状态机与租约管理)       │
│  - app/services/task_lease.py (任务级执行租约唯一实现)       │
│  - app/services/tools.py (Function Calling 安全工具集)       │
│  - app/services/webhook.py (插件 Webhook 签名执行器与出站通知)│
│  - app/services/dag_engine.py (DAG 工作流分层并行引擎)       │
│  - app/core/worker_registry.py (Worker 心跳注册与分布式锁)   │
│  - app/api/v1/endpoints/tasks.py (任务队列 + HITL approve/reject)│
│  - app/websocket/distributed.py (Redis Pub/Sub 跨进程总线)   │
└───────────────┬─────────────────────────────┬───────────────┘
                │ AsyncSession                │ 队列轮询 / 原子 Claim
                ▼                             ▼
┌───────────────────────────────┐ ┌───────────────────────────┐
│     SQLAlchemy 数据持久层     │ │    独立 Worker 消费进程   │
│  - 21 张领域数据表            │ │  - app/worker.py          │
│  - PostgreSQL (Alembic 治理)  │ │  - worker_concurrency 控制 │
│  - 默认工作区与 6 个预设 Agent │ │  - 租约心跳与死信重试      │
└───────────────────────────────┘ └───────────────────────────┘
```

---

## 2. 数据库表清单 (共 21 张)

| 表名 | 模块 | 核心作用 |
|---|---|---|
| `users` | 认证 | 用户账号 (`email`, `password_hash`, `display_name`, `avatar`, `is_active`, `last_login_at`) |
| `workspaces` | 租户 | 工作区与租户容器 |
| `workspace_memberships` | 权限 | 用户与工作区成员映射及角色 (`owner`, `admin`, `member`, `viewer`) |
| `workspace_invitations` | 邀请 | 工作区专属邀请码与核销状态 (`invite_code`, `role`, `expires_at`, `status`) |
| `audit_logs` | 审计 | 平台操作审计流水 (`action`, `resource_type`, `resource_id`, `detail`, `ip_address`) |
| `quota_configs` | 配额 | 工作区配额与限流规则 (`monthly_budget_usd`, `max_monthly_tokens`, `max_concurrent_tasks`, `is_hard_limit`) |
| `plugins` | 插件 | 插件元数据与 Manifest 定义 (`name`, `manifest_json`, `is_public`, `version`) |
| `workspace_plugins` | 插件 | 工作区挂载与凭证配置 (`workspace_id`, `plugin_id`, `is_enabled`, `config_json`) |
| `workflow_templates` (✨ 新增) | 工作流 | 工作流模板与 DAG 节点 (`workspace_id`, `name`, `nodes_json`, `variables_json`, `is_system`) |
| `workflow_runs` (✨ C-186 新增) | 工作流 | 工作流运行记录与节点快照 (`template_id`, `task_id`, `status`, `snapshot_nodes_json`) |
| `agents` | 智能体 | 预设与自定义 Agent (`role`, `model_name`, `system_prompt`, `status`) |
| `conversations` | 聊天 | 会话容器 |
| `messages` | 消息 | 聊天消息事实记录 |
| `tasks` | 任务 | 业务任务事实源 (`status`, `result`, `execution_token`, `execution_token_expires_at`) |
| `task_steps` | 步骤 | 任务各执行阶段输入、输出与耗时 |
| `task_queue_items` | 队列 | 任务持久化调度队列 (`status`: queued/leased/completed/dead, `attempt_count`) |
| `model_calls` | 审计 | LLM 调用统计 (`prompt_tokens`, `completion_tokens`, `cost`, `latency_ms`) |
| `provider_credentials` | 密钥 | 模型厂商 API Key 存储（掩码管理） |
| `custom_model_configs` | 模型 | 自定义模型与 Fallback 容灾映射 |
| `integration_nodes` | 外部接入 | 外部 Agent 集成节点注册（Cursor / Codex 桥接） |
| `refresh_tokens` (✨ 新增) | 认证 | 服务端 refresh token 记录与吊销 (`jti`, `expires_at`, `revoked_at`) |

---

## 3. Phase 4 全批次达成记录

| 批次 | 任务项 | 对应 PRD | 工单 ID | Commit SHA | QA 验收 |
|---|---|---|---|---|---|
| **Batch 1** | A1: 用户认证系统 (JWT / User 表 / Auth 页面) | `docs/prd/PRD-用户认证系统.md` | C-101 | `9337826` / `702942c` | ✅ APPROVED |
| **Batch 2** | A2: RBAC 角色权限 + A3: 多租户隔离 | `docs/prd/PRD-角色权限与多租户隔离.md` | C-103 | `ad18c19` / `22208c7` | ✅ APPROVED |
| **Batch 3** | B1: 平台级审计日志 + C1: 成本统计面板 | `docs/prd/PRD-平台级审计日志.md`<br>`docs/prd/PRD-成本统计面板.md` | C-105<br>C-106 | `1ca7aec` / `6019883` | ✅ APPROVED |
| **Batch 4** | B2: 任务回放与断点调试 + C2: 配额与限流治理 | `docs/prd/PRD-任务执行回放与单步调试.md`<br>`docs/prd/PRD-工作区配额与限流治理.md` | C-108<br>C-109 | `a4c0c1f` / `31ed948` | ✅ APPROVED |
| **Batch 5** | D1: 插件注册中心 (Manifest / 热插拔) | `docs/prd/PRD-插件注册中心.md` | C-110 | `037e968` / `9dbc783` | ✅ APPROVED |
| **Batch 6** | D2: 工作流模板引擎 (DAG 节点 / 一键实例化) | `docs/prd/PRD-工作流模板引擎.md` | C-111 | `19d4bdc` / `370021e` | ✅ APPROVED |

---

## 3.5 Phase 1 增量（C-183~C-187，2026-09-04 推送 94343a2）

| 工单 | 能力 | 类型 | 核心落地 |
|---|---|---|---|
| C-183 | 插件 Webhook 执行器与出站通知 | Requirement | `services/webhook.py` HMAC-SHA256 签名执行器 + 终态 fan-out；main/worker 双进程装载 |
| C-185 | HITL 人工审批节点 | Requirement | `dag_engine.py` human_approval 挂起分支 + `tasks.py` approve/reject 端点 + 前端审批按钮 |
| C-186 | DAG 工作流引擎 | Requirement | `services/dag_engine.py` 分层并行执行 + `workflow_runs` 表 + 节点快照 |
| C-184 | 测试环境修复 | BUG | conftest DATABASE_URL 钉一次性 SQLite；C-190 修 CI 挂 |

> 三项均已完成守则流程（PRD 三处同步 + 测试 + 验收 + 推送）。前端缺口登记在 20260907 报告 C1/C2/B1：C1（Webhook 配置 UI）已由 C-217 落地、C2（HITL 按钮角色控制）已由 C-214 落地，仅剩 B1（DAG 线性渲染）留 Phase 3 收尾。

## 4. 质量与验证基准

- **后端自动化测试**：44 个测试模块，共计 **270 tests passed**（100% 通过；测试用一次性 SQLite 文件库跑测，CI 另有 `test-postgres` job 覆盖 PG 方言，生产 PostgreSQL 由 `test_alembic_migrations.py` 保障迁移正确性；2026-08-29 compose 容器实跑 AC1/AC2/AC4/AC7/AC8 通过；2026-09-26 本机复跑 270 passed / PG 复跑 270 passed）。
- **CI 稳定性修复（2026-09-26）**：`test-postgres` 跨事件循环 Redis 客户端（配额限流单例）改为随循环重建；`build-linux` aiosqlite 取消期关闭竞争（WS 会话取消中断 DB 操作 → invalidate → terminate 双 stop 挂死）通过「WS 快照与会话释放前移到握手 accept 之前」根除；CI 增加 job `timeout-minutes`、pytest-timeout、无进展看门狗（dump 线程栈 + asyncio 任务栈）与 `-s` 诊断。修复后连续 3 次复跑三 job 全绿。
- **前端质量门禁**：`eslint` 0 error 0 warning，`node --test` 35 passed，`next build` 12+ 页面全部编译成功。
- **文档自动化体系**：14 列变更记录全量无空值，`PRD.md`、`Agent_Console_变更追踪.xlsx` 与 `PRD.html` 自动化生成并与 Git 历史完全同步。

---

## 5. 常用运行命令

### 启动后端
```powershell
cd E:\Agents\backend
uvicorn app.main:app --reload --port 8000
```

### 启动 Worker 进程
```powershell
cd E:\Agents\backend
python app/worker.py
```

### 启动前端控制台
```powershell
cd E:\Agents\frontend
npm run dev
```

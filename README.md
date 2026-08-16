# Agent Console

#### 寂静飞控台 · The Quiet Flight Desk

**多智能体不再散落各处。一张深色运控台，看见全局，精准调度。**



---

## 这是什么？

一个**本地优先（Local-First）的多智能体运控台** — 拒绝聊天玩具，拒绝黑盒执行，这套系统生来就是为了承接生产级协作的深色运控工作台。

在这里，你打字，Agent 干活。内置的高性能自研状态机自动为你驱动：**项目总设计师拆解任务 -> 专职 Worker 分工执行 -> 测试专员 QA 把关 -> 最终交付汇总**。
全程透明可视：每一步流转、每一次工具调用、每一次 Token 消耗和模型降级，全在 WebSocket 实时推到你的面板上。

```
你: "重构订单模块并更新前端页面" @项目总设计师
      │
      ▼
Manager 拆解 ──→ Worker 1: Agent工程师  ──→ Worker 2: 前端设计师
      │                    │                        │
      ▼                    ▼                        ▼
QA 审核 ←──────────────────────────────────────────┘
      │
      ▼
Manager 汇总 ──→ 最终结果实时回写到群聊气泡
```

---

## 全栈技术体系

我们摒弃了臃肿的 LangChain 与 AutoGen 黑盒，采用高内聚、全异步、强类型的现代化技术栈：

- **核心后端**：FastAPI + Python 3.11+ + SQLAlchemy 2.0 Async
- **前台基建**：Next.js 16 (App Router) + React 19 + TypeScript
- **设计系统**：Tailwind CSS v4 (原生 OKLCH 色板) + shadcn/ui + Lucide Icons
- **数据库与 ORM**：19 张企业级领域数据表（支持 SQLite 与 PostgreSQL 自动切换）
- **模型接入适配**：LiteLLM (统一适配 OpenAI/Anthropic/Gemini/DeepSeek/Qwen 等) + 动态 Fallback 降级
- **实时事件总线**：FastAPI Native WebSocket + Redis Pub/Sub 跨进程分布式总线
- **安全与身份**：PBKDF2-SHA256 密码哈希 + PyJWT 无感刷新 + 4 级 RBAC 权限矩阵

---

## 系统整体架构

```mermaid
flowchart TB
    U[用户 / 团队成员] --> FE[前端 Next.js 16 运控中心]

    subgraph 前端控制台矩阵
        FE --> C1[集群总览 /]
        FE --> C2[协同群聊 /chats]
        FE --> C3[智能体通讯录 /contacts]
        FE --> C4[任务队列与时序回放 /tasks]
        FE --> C5[工作流模板引擎 /workflows]
        FE --> C6[设置中心 /settings (成员/审计/成本/配额/插件)]
        FE --> C7[用户认证 /login /register]
    end

    FE -->|REST API (Bearer JWT)| API[FastAPI Backend /api/v1]
    FE <-->|WebSocket 实时通道| WS[WebSocket Manager / Redis 总线]

    API --> AUTH[用户认证与 RBAC 权限拦截]
    API --> AUDIT[平台异步审计日志拦截器]
    API --> QUOTA[工作区预算与配额限流熔断]
    
    API --> HUB[MessageHub 消息中心 / @Agent 意图解析]
    HUB --> TASK_SVC[TaskService 任务状态机与队列管理]
    TASK_SVC --> QUEUE[(task_queue_items 持久化队列)]
    
    QUEUE --> WORKER[独立 Worker 消费进程]
    WORKER --> ORCH[AgentOrchestrator 编排流水线]
    
    ORCH --> AGENTS[六人 Agent 编队层 (Manager/Worker/Reviewer/QA)]
    ORCH --> TRACE[ExecutionTrace 上下文追踪]
    ORCH --> TOOLS[Tools Registry / 插件注册中心热挂载]
    
    AGENTS --> LITELLM[LiteLLM 统一模型调度与容灾降级]
    LITELLM --> MODELS[模型与热配置 Key (DB 优先 > 环境变量 > Fallback)]

    API --> BRIDGE[外部 Agent 软件接入层 / Bridge 适配器]
    BRIDGE --> NODES[(integration_nodes 节点注册表)]
    BRIDGE --> CURSOR[Cursor Bridge]
    BRIDGE --> CODEX[Codex CLI Bridge]
    NODES -.->|WebSocket 心跳与状态推送| FE

    API --> DB[(SQLAlchemy 2.0 持久化 - 19 张数据表)]
    WORKER --> DB
```

---

## 编队体系：六人 Agent 矩阵

系统初始化即拉起一个高配 6 人工作组：

| Agent | 角色 | 职能定义 | 默认绑定模型位 |
| --- | --- | --- | --- |
| **项目总设计师** | `manager` | 复杂需求拆解 (JSON Plan)、任务分发、最终交付汇总 | `manager_model` |
| **Agent 工程师** | `agent_engineer` | 后端业务逻辑、算法实现、API 开发与集成 | `code_model` |
| **前端设计师** | `frontend_designer` | UI/UX 界面设计、前端组件化实现、交互还原 | `code_model` |
| **知识库管理员** | `knowledge_manager` | 技术长文写作、资料搜集、文档标准化整理 | `writing_model` |
| **测试专员** | `qa_engineer` | 质量把关 QA、验收核对、缺陷定位与修改建议 | `review_model` |
| **运维** | `devops` | 环境部署指导、Docker 编排与系统稳定性巡检 | `code_model` |

---

## 前端交互：全功能控制台矩阵

界面严格遵循 *"The Connected Cluster Lounge"* 极简结构美学，拒绝无意义光晕。

- 🎛️ **集群控制台 (`/`)**：全局监控 Agent 编队运行负载、外部 Agent 软件节点（Cursor / Codex / Trae / Antigravity）实时心跳与在线状态。
- 💬 **协同群聊 (`/chats`)**：支持 `@Agent` 智能联想、Prompt 快捷胶囊、Markdown 渲染，自动触发后台流水线。
- 📖 **通讯录 (`/contacts`)**：Agent 实名花名册，支持实时职责模糊过滤，快速发起协作。
- ⏱️ **任务与时序回放 (`/tasks`, `/tasks/[id]`)**：内嵌 `TaskReplayPlayer`，支持时间轴拖拽、1x~5x 倍速播放、Payload 检查及从失败步骤一键断点恢复执行。
- 🌿 **工作流模板引擎 (`/workflows`)**：预设与自定义多 Agent 编排流水线，支持动态参数表单填写与一键实例化调度。
- ⚙️ **设置中心 (`/settings`)**：
  - 👥 **成员与权限 (`/settings/members`)**：4 级 RBAC 角色升降、专属邀请码生成与核销。
  - 📋 **操作审计日志 (`/settings/audit`)**：全平台关键操作事实流水与明细抽屉。
  - 📊 **成本统计大屏 (`/settings/cost`)**：多维成本与 Token 聚合趋势、模型消耗占比与 Top 任务榜。
  - 🛡️ **配额与限流治理 (`/settings/quota`)**：月度预算 USD、Token 与并发水位大屏及硬限额熔断。
  - 🧩 **插件注册中心 (`/settings/plugins`)**：JSON Manifest 校验、工作区挂载与工具热插拔。
  - 🔌 **外部 Agent 软件接入**：通过 Bridge 适配器框架接入 Cursor / Codex CLI / Trae / Antigravity 等外部 Agent 软件，支持节点注册、心跳上报、任务派发与结果回传。

---

## 外部 Agent 软件接入与调度

系统支持将 `Cursor`、`Codex CLI`、`Trae`、`Antigravity` 等外部 Agent 软件作为执行节点纳入统一调度平面。

### 架构

```text
前端 Software Dock（动态数据驱动）
        ↓ REST API + WebSocket
FastAPI 后端
        ↓
Integration 接入层
   ├─ integration_nodes 节点注册表（状态 / 心跳 / 能力 / 并发）
   ├─ BaseBridge 适配器抽象基类
   ├─ CursorBridge（文件系统 Bridge）
   └─ CodexBridge（codex exec CLI 子进程）
        ↓
本地进程 / CLI / API / 桌面自动化
```

### 已实现能力

| 能力 | 说明 |
|------|------|
| 节点注册 | `POST /api/v1/integrations/nodes` |
| 节点列表 | `GET /api/v1/integrations/nodes?workspace_id=X` |
| 心跳上报 | `POST /api/v1/integrations/nodes/{id}/heartbeat` |
| 任务派发 | `POST /api/v1/integrations/dispatch`（手动指定或自动选择节点） |
| WebSocket 实时推送 | `integration.status_changed` / `integration.heartbeat` 事件 |
| 前端动态 Dock | 从后端 API 动态加载节点状态、能力、心跳与在线/离线标识 |

### Codex CLI 接入

```bash
# 1. 安装 Codex CLI
npm install -g @openai/codex

# 2. 首次运行登录
codex

# 3. 通过 API 派发任务到 Codex 节点
curl -X POST http://localhost:8000/api/v1/integrations/dispatch \
  -H "Content-Type: application/json" \
  -d '{"task_id": 42, "node_id": 2}'
```

Codex Bridge 会自动调用 `codex exec --json --sandbox workspace-write -o output.md "任务描述"`，将最终结果保存到 `data/bridges/workspace-{id}/Codex/task-{id}/` 目录。

---

## 运行时模型热管理与容灾降级

- **热生效凭证 (API Keys)**：在前端 `/settings` 面板写入的 API Key 直接通过数据库安全脱敏存储并立刻生效（`DB > Env`），日志打印全脱敏 (`[REDACTED]`)。
- **动态自定义模型**：支持在界面手动登记任意 `Provider/Model` 组合（如 `anthropic/claude-3-5-sonnet`）。
- **多级 Fallback 重试降级**：当主模型发生 429 限流、500 宕机或超时时，LiteLLM 层将自动无缝接管，沿降级链重试，并在最终日志中打上醒目的 `fallback_used: true` 标记。

---

## 一分钟跑起来

### Windows 全自动一键启动（推荐）

双击根目录 `start.bat` 或在终端运行 `start.ps1`。
脚本将自动拷贝环境变量 `.env`，拉起 Docker 容器，并每隔 3 秒轮询健康检查，就绪后将直接呼出浏览器。

### 本地直接开发启动

```powershell
# 1. 启动后端 (Port 8000)
cd backend
python -m uvicorn app.main:app --reload --port 8000

# 2. 启动前端控制台 (Port 3000)
cd frontend
npm run dev
```

- 控制台入口：[http://localhost:3000](http://localhost:3000)
- OpenAPI 文档：[http://localhost:8000/docs](http://localhost:8000/docs)
- 接口健康检查：[http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

---

## 系统演进路线图 (Roadmap)

- [x] **Phase 1: 稳定化**（PostgreSQL 兼容、统一任务状态机、任务执行解耦、AST 安全工具沙箱）
- [x] **Phase 2: 平台化**（持久化任务队列 `task_queue_items`、独立 Worker 消费进程、任务超时与死信管理）
- [x] **Phase 3: 分布式化**（Redis Pub/Sub 跨进程总线、WebSocket 连接解耦、Worker 集群租约）
- [x] **Phase 4: 产品化**
  - [x] **A1: 用户认证系统**（JWT 签发与刷新、User 模型、AuthGuard 路由守卫）
  - [x] **A2 & A3: RBAC 角色权限与多租户工作区隔离**（4 级角色矩阵、工作区切换器、邀请码）
  - [x] **B1: 平台级操作审计日志**（`audit_logs` 表、全局异步埋点与审计控制台）
  - [x] **C1: 成本统计面板**（多维聚合、每日趋势、模型分布与 Top 任务看板）
  - [x] **B2: 任务时序回放与断点单步调试**（`TaskReplayPlayer`、时序流与断点恢复）
  - [x] **C2: 工作区配额与限流治理**（`quota_configs` 表、月度硬熔断与水位大屏）
  - [x] **D1: 插件注册中心**（`plugins` 表、Manifest 校验与工具热插拔）
  - [x] **D2: 工作流模板引擎**（`workflow_templates` 表、DAG 编排与一键实例化）
  - [x] **E1: 外部 Agent 软件接入**（`integration_nodes` 表、Bridge 适配器框架、Cursor Bridge、Codex CLI Bridge、动态 Software Dock）

---

## License

MIT License
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

- **核心后端**：FastAPI + Python 3.11+
- **前台基建**：Next.js 16 (App Router) + React 19 + TypeScript
- **设计系统**：Tailwind CSS v4 (原生 OKLCH 色板) + shadcn/ui 无障碍基元
- **数据库与 ORM**：SQLite (aiosqlite) + SQLAlchemy 2.0 Async (平滑无缝切 PG)
- **模型接入适配**：LiteLLM (统一适配 OpenAI/Anthropic/Gemini/DeepSeek/Qwen 等)
- **实时事件总线**：FastAPI Native WebSocket + Hooks 双向通道

---

## 系统整体架构

```mermaid
flowchart TB
    U[用户] --> FE[前端 5 大可视化控制台]

    FE -->|REST API| API[FastAPI Backend /api/v1]
    FE <-->|WebSocket 实时事件通道| WS[WebSocket Manager]

    API --> HUB[MessageHub 消息中心\n@Agent 意图识别]
    HUB --> ORCH[AgentOrchestrator 任务状态机\n(带租约锁与崩溃自愈)]
    
    ORCH --> AGENTS[六人 Agent 编队层\nManager / Worker / Review / Final]
    ORCH --> TRACE[ExecutionTrace\n双级上下文压缩引擎]
    ORCH --> TOOLS[Tools Registry\nAST 安全沙箱工具箱]
    
    AGENTS --> LITELLM[LiteLLM 统一模型调度层]
    LITELLM --> MODELS[模型与热配置 Key\n(DB 优先 > 环境变量 > Fallback)]

    ORCH --> DB[(SQLAlchemy 2.0 异步持久化)]
    LITELLM --> DB
    
    DB --> ENTITIES[核心实体\nWorkspaces / Tasks / Steps / ModelCalls / Credentials]
    ORCH -.->|触发事件广播| WS
```



### 架构与容错亮点

1. **轻量级异步调度**：单机通过 `asyncio.create_task` 承载，抛弃 Celery 的运维包袱，后续仅需一行代码即可切到 Redis Worker。
2. **两级上下文压缩**：内置 `execution_trace` 防 Token 膨胀，确保多 Agent 交接时历史链路、工具产物不失忆且不超长。
3. **两阶段主备持久化**：主 Session 写库崩溃时，自动启用隔离备用 Session 将失败状态强落库，保证任务永不僵死。
4. **AST 安全沙箱工具箱**：抛弃危险的 `eval()`，使用 Python AST 白名单计算器，并硬防大指数 DoS 攻击。

---

## 编队体系：六人 Agent 矩阵

系统初始化即拉起一个高配 6 人工作组：


| Agent         | 角色                  | 职能定义                           | 默认绑定模型位         |
| ------------- | ------------------- | ------------------------------ | --------------- |
| **项目总设计师**    | `manager`           | 复杂需求拆解 (JSON Plan)、任务分发、最终交付汇总 | `manager_model` |
| **Agent 工程师** | `agent_engineer`    | 后端业务逻辑、算法实现、API 开发与集成          | `code_model`    |
| **前端设计师**     | `frontend_designer` | UI/UX 界面设计、前端组件化实现、交互还原        | `code_model`    |
| **知识库管理员**    | `knowledge_manager` | 技术长文写作、资料搜集、文档标准化整理            | `writing_model` |
| **测试专员**      | `qa_engineer`       | 质量把关 QA、验收核对、缺陷定位与修改建议         | `review_model`  |
| **运维**        | `devops`            | 环境部署指导、Docker 编排与系统稳定性巡检       | `code_model`    |


---

## 前端交互：五大核心控制台

界面严格遵循 *"The Connected Cluster Lounge"* 极简结构美学，拒绝无意义光晕。

- 🎛️ **集群控制台 (`/`)**：全局监控 Agent 编队运行负载、查看外部软件 Dock (如 TRAE, Cursor) 心跳与最近活跃输出流。
- 💬 **协同群聊 (`/chats`)**：支持 `@Agent` 智能联想、Prompt 快捷胶囊、全量 Markdown 代码渲染，提及发出的需求将自动触发后台任务流水线。
- 📖 **通讯录 (`/contacts`)**：Agent 实名花名册，支持实时职责模糊过滤，快速发起私聊。
- ⏱️ **任务与执行追踪 (`/tasks`)**：实时总览排队/运行/失败状态。任务详情提供 **Pipeline 拓扑图**、**执行轨迹时间线** 以及 **模型调用审计日志**（精确计算单次调用耗时 ms、Tokens 和预估美金成本）。
- ⚙️ **设置中心 (`/settings`)**：动态录入与删除各厂商 API Key（数据库存储优先，免重启热生效），配置自定义模型及 `Fallback` 降级链，支持一键测速 Ping。

---

## 运行时模型热管理与容灾降级

摆脱改 YAML 重启的噩梦。系统具备完备的模型动态配置与容灾自救机制：

- **热生效凭证 (API Keys)**：在前端 `/settings` 面板写入的 API Key 直接通过数据库安全脱敏存储并立刻生效（`DB > Env`），日志打印全脱敏 (`[REDACTED]`)。
- **动态自定义模型**：支持在界面手动登记任意 `Provider/Model` 组合（如 `anthropic/claude-3-5-sonnet`）。
- **多级 Fallback 重试降级**：当主模型（如 DeepSeek）发生 429 限流、500 宕机或超时时，LiteLLM 层将自动无缝接管，沿降级链（如切到 `cheap_model` Qwen）重试，并在最终日志中打上醒目的 `fallback_used: true` 标记。

---

## 一分钟跑起来

### Windows 全自动一键启动（推荐）

双击根目录 `start.bat` 或在终端运行 `start.ps1`。
脚本将自动拷贝环境变量 `.env`，拉起 Docker 容器，并每隔 3 秒轮询健康检查，就绪后将直接呼出浏览器。

### 手动容器化启动

```powershell
Copy-Item .env.example .env
docker compose up --build
```

- 控制台入口：[http://localhost:3000](http://localhost:3000)
- OpenAPI 文档：[http://localhost:8000/docs](http://localhost:8000/docs)
- 接口健康检查：[http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

> 💡 **Tip**：服务就绪后，直接进入前端 `/settings` 页面输入所需大模型厂商的 API Key，然后在 `/chats` 输入 `@项目总设计师 帮我写个贪吃蛇` 即可自动运转全套流水线！

---

## 系统演进路线图 (Roadmap)

- [x] Windows 一键自动化启动脚本与容器编排
- [x] `/contacts` 独立通讯录与角色展板
- [x] Agent 内部安全沙箱工具调用闭环（Function Calling）
- [x] 单任务双层上下文连续性与执行轨迹视图 Trace
- [x] 用户级别 API Key 热配置与自定义模型降级管理
- [ ] 引入 Alembic 进行数据库 Schema 版本自动迁移
- [ ] 引入 Redis Celery / RQ 队列，实现分布式后台重型调度
- [ ] Worker 并发执行改造（SQLite -> Postgres 后启用 `asyncio.gather`）
- [ ] Redis Pub/Sub 多进程 WebSocket 频道广播
- [ ] 测试专员 (QA) 驳回后触发 Worker 自动修改重试回路

---

## License

TBD
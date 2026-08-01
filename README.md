# Agent Console · 多智能体协同运行台

Agent Console 是一个本地优先的多 Agent 协作控制台，集成 Next.js 前端、
FastAPI 后端、SQLite 持久化、LiteLLM 模型路由和按工作区隔离的 WebSocket
实时事件，让用户可以群聊派发任务、观察执行过程和检查模型调用链路。

项目定位为协调型 Agent 工作台的 MVP，而非营销站点。首屏即为运控台：
Agent 状态、群聊、任务执行、模型设置和通讯录式 Agent 编队视图。

## 功能特性

- 多 Agent 面板，预置 6 个角色：
  - 项目总设计师（Project Architect）
  - Agent 工程师（Agent Engineer）
  - 前端设计师（Frontend Designer）
  - 知识库管理员（Knowledge Manager）
  - 测试专员（QA Engineer）
  - 运维（Operations Engineer）
- 群聊工作流，支持 `@Agent` 提及自动创建任务。
- 任务执行生命周期：
  - `pending`（等待处理）
  - `running`（进行中）
  - `completed`（已完成）
  - `failed`（失败）
- 单 Agent 直调路径，用于直接派发的任务。
- Manager 主导的多 Agent 流水线：
  - Manager 任务拆解
  - Worker 执行
  - 测试专员审核
  - Manager 最终汇总
- LiteLLM 模型抽象层，支持 provider 降级链。
- 按工作区隔离的 WebSocket 事件：消息、任务、步骤、Agent 状态、
  模型调用和错误。
- SQLite 持久化，启动自动建表，幂等种子数据。
- 进程重启后自动恢复未完成的任务。
- 失效 SQLAlchemy 会话的 fallback 失败持久化。
- 前端对非标准 API 错误响应的数据守卫。
- 按工作区的并发控制（最多 3 个进行中任务，超出返回 429）。
- 从 LiteLLM 响应中提取模型调用成本并记录到 `ModelCall.cost`。
- React Error Boundary 覆盖全部 5 个页面组件，含本地化 fallback UI。
- 共用 WebSocket 连接 Hook，消除 4 处重复的重连逻辑。
- 任务状态工具函数去重（`taskTimestamp`、`taskStatusRank`、
  `shouldApplyTaskStatus`），提取到共享模块。
- 全部数据加载 Hook 添加 `fetchedRef` 防护（React StrictMode 双重请求）。
- 前端常量集中管理（重连延迟、列表上限、刷新间隔等）。
- `task.step_changed` WebSocket 事件使用 Pydantic Schema 替代手写字典。
- 前端单元测试覆盖（28 个测试）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Next.js App Router、React、TypeScript、Tailwind CSS、shadcn 风格 UI 原语 |
| 后端 | FastAPI、Python、SQLAlchemy asyncio、Pydantic |
| 数据库 | SQLite + `aiosqlite` |
| 模型调用 | LiteLLM |
| 实时通信 | WebSocket |
| 本地编排 | Docker Compose |
| 测试 | pytest、Node test runner、ESLint、Next 生产构建 |

## 目录结构

```text
.
|-- backend/
|   |-- app/
|   |   |-- agents/        # Manager、Worker、Review、Final Agent 提示词
|   |   |-- api/           # REST 接口与错误包装
|   |   |-- core/          # MessageHub、Orchestrator、Config
|   |   |-- db/            # 异步会话、Schema 初始化、种子数据
|   |   |-- models/        # SQLAlchemy 模型
|   |   |-- schemas/       # Pydantic 请求/响应 Schema
|   |   |-- services/      # LiteLLM 集成
|   |   `-- websocket/     # 工作区 WebSocket 路由与管理器
|   `-- tests/             # 后端 pytest 测试套件（37 个测试）
|-- config/
|   `-- models.yaml        # 模型别名与降级配置
|-- docs/
|   |-- api-examples.md
|   `-- websocket.md
|-- frontend/
|   |-- src/app/           # Next.js 路由
|   |-- src/components/    # 控制台、群聊、任务、设置、ErrorBoundary
|   |-- src/hooks/         # 数据加载、WebSocket、共用 Workspace Socket
|   |-- src/lib/           # API 客户端、格式化、任务工具函数、常量
|   |-- src/types/         # 前端 TypeScript 类型
|   `-- tests/             # Node test runner 测试（28 个测试）
|-- docker-compose.yml
|-- .env.example
`-- HANDOFF.md
```

## Docker 快速启动

前置条件：

- Docker Desktop
- Git

```powershell
Set-Location E:\Agents
Copy-Item .env.example .env
docker compose up --build
```

打开：

- 前端：http://localhost:3000
- 后端文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/api/v1/health

后端在启动时自动创建 SQLite Schema 和种子数据。

## 本地开发

### 后端

```powershell
Set-Location E:\Agents\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

### 前端

打开第二个终端：

```powershell
Set-Location E:\Agents\frontend
npm install
npm run dev
```

打开 http://localhost:3000。

## 环境变量

从 `.env.example` 开始配置。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `APP_NAME` | `Agent Console API` | 后端服务名称 |
| `APP_ENV` | `development` | 运行环境 |
| `API_V1_PREFIX` | `/api/v1` | 健康检查/版本化 API 前缀 |
| `CORS_ORIGINS` | localhost 及 127.0.0.1 前端来源 | 允许的浏览器跨域来源 |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | 前端到后端的 API 地址 |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/agent_console.db` | 后端数据库地址 |
| `REDIS_URL` | `redis://localhost:6379/0` | 本地 Redis 地址（为队列/缓存预留） |
| `COMPOSE_REDIS_URL` | `redis://redis:6379/0` | Docker 内部 Redis 地址 |
| `MODELS_CONFIG_PATH` | `config/models.yaml` | LiteLLM 模型别名配置 |
| `MODEL_REQUEST_TIMEOUT_SECONDS` | `60` | 单次模型调用超时时间 |
| `OPENAI_API_KEY` | 空 | OpenAI 凭证（可选） |
| `ANTHROPIC_API_KEY` | 空 | Anthropic 凭证（可选） |
| `GEMINI_API_KEY` | 空 | Gemini 凭证（可选） |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 凭证（可选） |
| `DASHSCOPE_API_KEY` | 空 | DashScope 凭证（可选） |
| `QWEN_API_KEY` | 空 | Qwen 凭证（可选） |

真实凭证仅写入 `.env`，不要提交 `.env`。

## 模型配置

模型别名在 `config/models.yaml` 中定义。Agent 存储模型别名（如
`manager_model`、`code_model`、`review_model`、`writing_model`）。
后端通过 LiteLLM 解析别名，并在主 provider 缺少凭证、超时或返回错误时
按配置的降级链依次尝试。

如果所有 provider 尝试均失败，失败信息将存入 `model_calls`，呈现到任务中，
并发送给连接的 WebSocket 客户端。

## API 与实时事件

健康检查端点：

```text
GET /api/v1/health
```

业务端点挂载在 `/api` 下，包括：

- `/api/workspaces`
- `/api/agents`
- `/api/conversations`
- `/api/conversations/{conversation_id}/messages`
- `/api/tasks`
- `/api/tasks/{task_id}`
- `/api/tasks/{task_id}/run`
- `/api/models`
- `/api/models/test`

工作区 WebSocket 路由：

```text
ws://localhost:8000/ws/workspaces/{workspace_id}
```

主要事件类型：

- `message.created`
- `task.status_changed`
- `task.step_changed`
- `agent.status_changed`
- `model.call_finished`
- `error`

## 测试

运行后端检查：

```powershell
Set-Location E:\Agents\backend
python -m compileall -q app tests
python -m pytest -q             # 37 个测试
```

运行前端检查：

```powershell
Set-Location E:\Agents\frontend
npm test                        # 28 个测试
npm run lint
npm run build
```

已知本地说明：在此 Windows 环境下，pytest 可能在测试成功运行后输出临时
目录清理警告（如 `WinError 145`）。重要信号是命令退出码和 pytest 通过数。

## 当前加固情况

### 健壮性

- 任务、消息、会话列表的分页上限。
- 前端对过期 WebSocket 事件的守卫。
- 可观测的后台任务派发。
- 原子化的 `pending -> running` 任务认领。
- 模型调用超时处理。
- 启动时恢复未完成的 `pending` 和中断的 `running` 任务。
- 失效 SQLAlchemy 会话的 fallback 失败持久化。
- 前端对非标准 API 错误体的安全归一化处理。
- 按工作区对齐的 Agent Console 加载和 WebSocket 订阅。

### 代码质量

- 共用 `useWorkspaceSocket` Hook，从 4 处重复的 WebSocket 连接实现中提取。
- `taskTimestamp`、`taskStatusRank`、`shouldApplyTaskStatus` 从
  `useChat` 和 `useTasks` 中去重，提取到 `lib/task-utils.ts`。
- 移除死代码：`SystemStatus`、`SoftwareDock` 占位组件，以及冗余的
  `selectConsoleAgents` 过滤函数。
- `ErrorBoundary` 组件包裹全部 5 个页面组件，含本地化 fallback UI 和重试按钮。
- 常量集中管理（`RECONNECT_DELAY_MS`、`TASK_REFRESH_DELAY_MS`、
  `MESSAGE_LIST_LIMIT`、`TASK_LIST_LIMIT`、`CONVERSATION_LIST_LIMIT`）
  于 `lib/constants.ts`。
- `fetchedRef` StrictMode 双重请求防护覆盖全部数据加载 Hook。
- `TaskStepEventPayload` Pydantic Schema 替换 `task.step_changed` 中的
  手写字典。
- 按工作区并发任务上限（最多 3 个进行中任务，超出返回 429）。
- 从 LiteLLM 响应提取模型调用成本，写入 `ModelCall.cost`。
- `MessageType.receipt` 标注为未来功能预留。
- 前端测试覆盖从 2 个扩展到 28 个，覆盖共享任务工具函数、格式化辅助函数
  和 API 客户端成功路径。

## 代码仓库

本仓库发布于 https://github.com/liwe123/Agent-Togterher。

推送变更：

```powershell
Set-Location E:\Agents
git push -u origin main
```

## 路线图

- 在 Schema 变更频繁前引入 Alembic 迁移。
- 将进程内后台派发替换为持久化的 Redis 消息队列 Worker。
- 多 Agent 工作流中 Worker 阶段并行化（当前因 SQLite 写入限制为串行；
  `core/orchestrator.py` 中有 `TODO` 标记了迁移 PostgreSQL 后的
  `asyncio.gather` 改造点）。
- 引入 Redis Pub/Sub 或其他共享事件总线以支持多进程 WebSocket 广播。
- 增加 Worker 输出未通过 QA 审核时的重试/复核循环。
- 扩展前端测试覆盖 WebSocket 重连、Hook 状态转换以及端到端群聊/任务流程。

## 许可证

尚未选择许可证。公开发布前请添加许可证。

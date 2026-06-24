# Agent Console MVP 接力文档

更新时间：2026-06-24（项目最终验收与任务自动触发机制优化完成）  
工作目录：`E:\Agents`

## 1. 项目目标

构建支持多模型、多 Agent、群聊协作、`@Agent`、任务分发、状态同步、模型调用日志和 WebSocket 实时推送的协同控制台。

技术栈：

- 前端：Next.js + React + TypeScript + Tailwind CSS + shadcn/ui
- 后端：FastAPI + Python
- 数据库：SQLite + SQLAlchemy，后续可迁移 PostgreSQL
- 缓存/队列：Redis
- 模型调用：LiteLLM
- 实时通信：WebSocket
- 容器：Docker Compose

---

## 2. 当前阶段

项目已顺利通过全面的验收检查，并在后端提供了**接收用户消息自动在后台触发运行**（`MessageHub` -> `orchestrator.run_task`）的体验改进，使群聊派发任务能够开箱即用自动运转。

当前已有：
- 项目骨架、前后端健康检查、七张 SQLAlchemy 数据库表。
- **自动建表和 Seed 填充**：FastAPI 启动时，`lifespan` 自动初始化数据库 Schema 并调用 seed 模块填充默认工作区和六个 Agent 角色。
- **任务自动后台启动**：`MessageHub.receive_user_message` 提交事务后使用 `asyncio.create_task` 自动异步触发 `run_task` 启动，并实时广播给前端。
- 基础 REST API 和统一成功/错误响应包装。
- 按工作区隔离的 WebSocket 通信、六类实时事件广播。
- 统一 LiteLLM 调用层、多级 Fallback 容灾降级机制。
- MessageHub 消息与任务分发（支持中英文 `@Agent` 解析）。
- 同步 Agent Orchestrator 链路（项目总设计师 → Worker 顺序执行 → 测试专员审核 → 总设计师最终汇总）。
- Next.js 深色控制台、`/chats` 群聊页、`/tasks` 任务列表与详情页、`/settings` 模型设置与密钥连通性测试页。
- **基础测试套件**：涵盖 API 启动、数据库表创建、Seed 幂等性执行、模型测试接口连通性、WebSocket 连通性。
- **CORS 多端口放行**：完美支持 `localhost` 与 `127.0.0.1` 跨域。
- **全面完善的文档与忽略规则**：提供了完整的 README 说明、配置列表、FAQ 手册与标准 `.gitignore` 规则。

尚未实现：
- Alembic 数据库版本迁移。
- Redis 并发队列任务派发、并发锁与任务重试/幂等。
- Redis Pub/Sub 多进程 WebSocket 分发。
- 异步/并行多 Agent 执行。
- 阻断性问题的修改/复审回路。
- `/contacts` 通讯录独立页面。

---

## 3. 实现与优化改动

核心改动：

- **任务异步自动触发**：
  - 修改 `backend/app/core/message_hub.py`，在 `receive_user_message` 中新增了 `asyncio.create_task(run_task(task.id))`。使用户在群聊中提及 `@Agent` 时不仅能生成 pending 任务，还会在后台直接触发该任务的执行链，并将所有的执行进度（`running` -> `model.call_finished` -> `failed/completed`）实时推送到群聊气泡和控制台，完成 MVP 端到端自动化流转。
- **数据库与 Seed 自动化**：
  - 修改 `backend/app/main.py` 的 `lifespan`，在应用启动时自动调用 `seed_defaults` 保证项目无需单独运行 seed 命令即可开箱即用。
- **CORS 兼容性提升**：
  - 修改 `backend/app/core/config.py` 中的 `cors_origins` 默认配置，同时支持 `http://localhost:3000` 和 `http://127.0.0.1:3000`。
  - 同步修改 `.env.example` 和 `docker-compose.yml` 中的 CORS_ORIGINS 默认环境变量。
- **前端网络异常保护与重构**：
  - 修改 `frontend/src/lib/task-api.ts` 的 `apiBaseUrl`，当环境变量 `NEXT_PUBLIC_API_BASE_URL` 为空字符串 `""` 时，正确回退到 `http://localhost:8000`，避免对同端口发出错误请求。
  - 重构 `frontend/src/hooks/use-agent-console.ts` 和 `frontend/src/hooks/use-chat.ts`，彻底移除本地重复定义的 `apiBaseUrl`、`websocketBaseUrl` 和 `requestData`，全部通过 `@/lib/task-api` 引入。
- **容器环境微调**：
  - 修改 `docker-compose.yml` 里的 backend 健康检查 URL，将 `localhost` 改为 `127.0.0.1` 规避 IPv6 优先解析导致的健康检查假死。
- **基础测试扩展**：
  - 新置 `backend/tests/test_basic_startup.py`，设计了 5 个核心测试用例验证系统最小集（API/数据库/Seed/模型测试/WebSocket）。
- **版本库忽略规则**：
  - 修改根目录 `.gitignore`，规范并补齐了 `.env`、`__pycache__`、`node_modules`、`.next`、`dist`、`*.db`、`*.sqlite` 的忽略规则。
- **文档体系建设**：
  - 重写 `README.md`，添加了功能列表、环境变量说明、详细启动方式、测试方式和包含 CORS、Docker 权限等场景的常见问题 (FAQ) 目录。

---

## 4. 验证结果

- **后端测试**：
  - 在 `E:\Agents\backend` 运行 `python -m pytest`，全量 **31Passed** (26个原有测试 + 5个新增基础测试)，无 Error/Warning。
- **前端构建**：
  - 在 `E:\Agents\frontend` 运行 `npm run lint`，**无 Warning，无 Error** 完美通过。
  - 在 `E:\Agents\frontend` 运行 `npm run build`，生产构建顺利完成。

---

## 5. 精确运行命令

### 一键容器启动：
```powershell
Set-Location E:\Agents
Copy-Item .env.example .env
docker compose up --build
```
*启动后浏览器访问 `http://localhost:3000` 即可直接使用系统所有功能。*

### 本地开发运行：
```powershell
# 后端
Set-Location E:\Agents\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# 前端 (新窗口)
Set-Location E:\Agents\frontend
npm install
npm run dev
```

### 全量测试运行：
```powershell
Set-Location E:\Agents\backend
python -m pytest
```

---

## 6. 下一阶段建议

1. **Alembic 数据库迁移**：引入 Alembic 迁移脚本，开始版本化追踪后续的表结构变更（如为任务表添加 error_message 或为 Agent 表添加更多个性化字段）。
2. **异步任务队列**：将当前在 `POST /api/tasks/{task_id}/run` 请求中同步堵塞运行的 Orchestrator 改为使用 Redis Celery / RQ 队列，实现异步后台执行，支持任务分发、并行 Worker 执行以及超时恢复。
3. **WebSocket 广播升级**：由于当前的 `websocket_manager` 是单进程内存管理，建议为多 worker / 容器多副本部署准备 Redis Pub/Sub，实现跨进程的实时事件广播。
4. **测试专员审核重试机制**：为 Worker 与 Reviewer (测试专员) 增加 1~3 次的阻断修改重试回路，允许 Worker 根据 Reviewer 的建议自我更新并再次提交审核。
5. **联系人页面开发**：构建前端 `/contacts` 通讯录页面，支持对工作区中 Agent 实体的添加、编辑和状态查看。

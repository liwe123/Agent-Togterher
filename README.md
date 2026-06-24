# Agent Console MVP

一个面向多模型、多 Agent 协同的实时控制台系统。本项目旨在构建一个支持多模型调用、多 Agent 协同、群聊互动（支持 `@Agent`）、任务自动分发、执行状态同步、详细模型调用日志和 WebSocket 实时数据推送的高性能协同控制台。

---

## 功能列表

1. **多 Agent 实时协同控制台**
   - 展示六个核心 Agent 的运行状态（空闲、运行中、失败）与模型绑定配置。
   - 包含项目总设计师、Agent工程师、前端设计师、知识库管理员、测试专员、运维六个预设角色。
   - 顶部提供常用开发工具（TRAE、Codex、Cursor、Claude、Gemini 等）的卡片入口。

2. **工作区群聊互动与任务派发**
   - 实时消息对话面板，支持 `@Agent`（中英文）直接派发任务。
   - 支持 mention 过滤菜单、鼠标/键盘快捷操作。
   - 用户发送消息时，MessageHub 在同一事务中原子创建消息和 `pending` 任务，并精准将任务状态关联至用户气泡。

3. **任务列表与聚合详情**
   - 提供基于状态的实时任务筛选（全部、等待处理、进行中、已完成、失败）。
   - 聚合展示任务原始输入、各步骤的详细时间线（Agent 执行输入/输出/耗时）及模型调用日志。

4. **双通道 Agent 编排机制 (Orchestrator)**
   - **单 Agent 路径**：普通 Agent 独立执行任务。
   - **多 Agent 协同路径**：项目总设计师接收任务后，自动拆解为 1-3 个子任务，分配给对应 Worker（前端、后端、知识库、运维），经测试专员审核后由总设计师生成最终汇总。

5. **统一 LiteLLM 调用与 Fallback 容灾**
   - 通过 LiteLLM 统一接入 OpenAI、Anthropic、Gemini、DeepSeek、Qwen 等模型。
   - 读取 `config/models.yaml` 自动映射别名与主/备用模型，并在主模型调用失败或未配置 Key 时自动执行多级 Fallback 降级。

6. **按工作区隔离的 WebSocket 广播**
   - 前后端通过 WebSocket 保持实时长连接（支持断线自动重连）。
   - 推送 `message.created`、`task.status_changed`、`task.step_changed`、`agent.status_changed`、`model.call_finished` 和 `error` 等六大核心事件。

7. **实时连通性模型测试**
   - 在设置页面中支持单独测试五类模型别名的网络连通性，返回延迟、Token 消耗、Provider 及实际响应。

---

## 技术栈

- **前端**：Next.js (App Router, Standalone 模式)、React、TypeScript、Tailwind CSS、shadcn/ui
- **后端**：FastAPI、Python、SQLAlchemy (Asyncio)、aiosqlite
- **缓存/队列**：Redis (预留)
- **模型调用**：LiteLLM
- **实时通信**：WebSocket
- **容器化**：Docker Compose

---

## 目录结构

```text
.
├── frontend/
│   ├── src/app/                 # Next.js 页面与路由
│   ├── src/components/console/  # 控制台面板与 Agent 群像组件
│   ├── src/components/chat/     # 聊天会话、消息气泡与 @菜单组件
│   ├── src/components/tasks/    # 任务列表、步骤时间线与日志组件
│   ├── src/hooks/               # 前端业务状态与 WebSocket Hook
│   ├── src/lib/                 # 统一 API 请求与显示格式化工具
│   ├── src/types/               # 前端数据与事件类型定义
│   └── Dockerfile               # 前端多阶段构建 Dockerfile
├── backend/
│   ├── app/api/                 # REST 接口与路由 (包含 /api/v1/health 及业务端点)
│   ├── app/agents/              # Manager、Worker、Review、Final 模型提示词与解析
│   ├── app/core/                # 核心配置、MessageHub 与 Orchestrator 引擎
│   ├── app/db/                  # 数据库会话、表定义与 seed 初始化逻辑
│   ├── app/models/              # SQLAlchemy 实体模型定义
│   ├── app/schemas/             # Pydantic 输入输出 Schema 约束
│   ├── app/services/            # LiteLLM 接入与 Fallback 服务
│   ├── app/websocket/           # WebSocket 路由与连接广播管理器
│   ├── tests/                   # 后端测试套件 (pytest)
│   └── Dockerfile               # 后端轻量化 Dockerfile
├── config/
│   └── models.yaml              # 模型角色映射与 fallback 配置
├── docker-compose.yml           # 全容器一键编排配置文件
├── .env.example                 # 环境变量配置模板
└── HANDOFF.md                   # 阶段接力开发文档
```

---

## 环境变量说明

创建 `.env` 时，可配置以下环境变量控制系统行为：

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `APP_NAME` | `Agent Console API` | 后端服务名称 |
| `APP_ENV` | `development` | 运行环境 (development / production) |
| `API_V1_PREFIX` | `/api/v1` | 基础接口前缀 |
| `CORS_ORIGINS` | `["http://localhost:3000", "http://127.0.0.1:3000"]` | 跨域允许的来源主机列表 (必须为 JSON 数组格式) |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/agent_console.db` | 后端数据库连接串 |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | 前端请求后端的 API 基础地址 (构建/运行期使用) |
| `REDIS_URL` | `redis://localhost:6379/0` | 本地 Redis 缓存连接串 |
| `COMPOSE_REDIS_URL` | `redis://redis:6379/0` | Compose 容器内部 Redis 缓存连接串 |
| `MODELS_CONFIG_PATH` | `config/models.yaml` | 模型角色别名配置文件路径 |
| `OPENAI_API_KEY` | *(可选)* | OpenAI API 密钥，未配置时自动降级 fallback |
| `ANTHROPIC_API_KEY` | *(可选)* | Anthropic (Claude) API 密钥 |
| `GEMINI_API_KEY` | *(可选)* | Gemini API 密钥 |
| `DEEPSEEK_API_KEY` | *(可选)* | DeepSeek API 密钥 |
| `DASHSCOPE_API_KEY` | *(可选)* | DashScope / 通义千问 API 密钥 |
| `QWEN_API_KEY` | *(可选)* | Qwen 兼容模型 API 密钥 |

---

## 启动方式

### 1. 一键 Docker Compose 启动 (推荐)

项目已进行容器化封装，可通过以下命令一键拉取镜像并编译启动：

1. **复制并创建本地环境变量文件**：
   ```powershell
   Copy-Item .env.example .env
   # 根据需要编辑 .env 填入相应的 API Key
   ```
2. **一键构建并启动服务**：
   ```powershell
   docker compose up --build
   ```
3. **验证启动状态**：
   - 前端页面：[http://localhost:3000](http://localhost:3000)
   - 后端文档：[http://localhost:8000/docs](http://localhost:8000/docs)
   - API 健康状态：[http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)

*(注：系统在启动时会自动创建 SQLite 数据库文件并执行 Seed 数据导入，无需手动执行数据库初始化)*

---

### 2. 本地开发调试启动

如果你需要在本地不借助 Docker 独立运行项目进行开发：

#### 后端启动：
1. **创建并激活虚拟环境**：
   ```powershell
   python -m venv backend/.venv
   backend/.venv\Scripts\Activate.ps1
   ```
2. **安装依赖并启动**：
   ```powershell
   pip install -r backend/requirements-dev.txt
   Set-Location backend
   uvicorn app.main:app --reload --port 8000
   ```

#### 前端启动：
1. **安装前端依赖并启动**：
   ```powershell
   Set-Location frontend
   npm install
   npm run dev
   ```
2. **访问前端**：打开 [http://localhost:3000](http://localhost:3000)（请优先使用 localhost，以便与后端 CORS 白名单匹配）。

---

## 测试方式

### 1. 后端自动化测试
后端使用 `pytest` 编写了完整的单元与集成测试。请确保激活了 `backend/.venv` 虚拟环境，在 `backend` 目录下执行：
```powershell
python -m pytest
```
测试会自动使用临时数据库文件运行所有测试（共 31 项），并在执行完毕后自动清理临时文件。测试套件包括：
- 后端 API 是否能启动 (`test_backend_api_starts`)
- 数据库表是否能正确创建 (`test_database_creation`)
- Seed 数据是否能正确导入且幂等 (`test_seed_execution`)
- 模型连通性测试接口是否可用 (`test_model_test_endpoint_available`)
- WebSocket 按工作区订阅是否能正常连接 (`test_websocket_connectable`)
- 多 Agent 工作流生命周期及 mention 提取集成测试

### 2. 前端代码质量与构建检查
在 `frontend` 目录下，您可以执行以下命令验证类型安全性与编译状态：
```powershell
# 静态代码分析
npm run lint

# 生产环境编译构建
npm run build
```

---

## 常见问题 (FAQ)

### Q1: 运行前端时页面显示“没有可用工作区，请先启动后端完成默认数据初始化”？
**A**: 这表示前端成功加载了页面，但无法从后端 API 获取到初始化的工作区数据。请确保：
1. 后端服务已在 `8000` 端口正常运行。
2. 数据库已自动 Seed 成功。如果是在本地非 Docker 环境运行，可尝试手动在 `backend` 目录下运行 `python -m app.db.seed`。
3. 检查控制台网络选项，确认请求没有被 CORS 拦截。

### Q2: 浏览器控制台出现 "CORS blocked" 跨域拒绝错误？
**A**: 后端默认仅允许 `http://localhost:3000` 和 `http://127.0.0.1:3000` 访问。如果您使用自定义 IP 或域名访问前端：
- 请修改根目录 `.env` 文件中的 `CORS_ORIGINS`，添加您的访问来源（例如 `CORS_ORIGINS=["http://localhost:3000", "http://127.0.0.1:3000", "http://192.168.1.100:3000"]`）。
- 修改后，需要重启后端容器以加载最新配置。

### Q3: 运行 Docker Compose 时，数据库文件不可写入或提示 "Permission Denied"？
**A**: 本项目在 Docker 中使用非 root 用户 `app` 运行后端。如果数据卷在宿主机挂载时产生了 root 权限残留：
- 建议执行 `docker compose down -v` 清除残留的物理卷，然后重新运行 `docker compose up --build`。
- 在 Windows 环境下，Docker Desktop 挂载卷通常会自动映射，如果遇到阻碍，请检查 Docker Desktop 的共享文件夹访问权限。

### Q4: 连通性测试时显示“主模型和备用模型均失败”？
**A**: 本系统采用双通道模型调用机制：
1. 请检查您的 `.env` 文件中是否填写了有效且额度充足的 API Key（例如 `DEEPSEEK_API_KEY`）。
2. 请确认您的本地或 Docker 容器网络能够正常访问相应 Provider 的 API 域名（例如国内网络访问 OpenAI 官方 API 可能会超时，此时系统会自动寻找 models.yaml 中配置的 `fallback_model`，即国内能直接连通的 Qwen 别名模型）。

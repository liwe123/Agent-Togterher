# PRD：独立 Worker 与事件总线链路启用

> 类型：技术补完（Requirement）｜状态：已完成（2026-08-28 代码落地：C-169 启用链路 + C-171 续租修复；A/B 与冒烟测试通过。容器实跑验证 AC1/AC4/AC8 受本机镜像拉取带宽限制，列为待补做项）｜编号：**C-170**｜日期：2026-08-28
>
> 目标：把「**代码已经写完、但从来没有真正启用**」的分布式调度与事件链路接通 —— 让独立 Worker 进程真正消费持久化任务队列，让 Redis 事件总线真正承担跨实例 WebSocket 广播，从而使项目文档中 Phase 2「持久化任务队列 / 独立 Worker」与 Phase 3「事件总线 / 多实例 WebSocket 解耦」的「✅ 已达成」断言成立。
>
> 来源：《代码与计划落地差距审查报告-20260828》§1.1、§1.2、§8（P0-1 / P0-2）。

---

## 1. 背景与问题

### 1.1 现状事实

2026-08-28 的全仓库审查得到一个刺眼的结论：**代码真实完成度比文档谦虚，但有一批能力"写了没接上"。**

| 能力 | 代码实现 | 是否真的在跑 | 证据 |
|------|----------|--------------|------|
| 独立 Worker 进程 | ✅ 完整（队列消费、并发信号量、优雅退出） | ❌ **死代码，无任何启动入口** | `backend/app/worker.py:40-66`；`docker-compose.yml` / `start.bat` / `start-local.bat` / `start.ps1` 均搜不到 `worker` 字样 |
| 持久化任务队列 | ✅ 模型 + `TaskService` 完整 | ⚠️ **只写不消费，队列是影子** | `task_queue_items` 表 + `backend/app/services/task_service.py`；`message_hub.py:249` 会 `enqueue(task)` |
| 默认执行模式 | — | ❌ `task_execution_mode = "inline"` | `backend/app/core/config.py:30`（改动前） |
| Redis 事件总线 | ✅ 完整（`RedisEventBus` + pubsub） | ❌ **默认关闭且部署未打开** | `backend/app/websocket/distributed.py:32-125`；`config.py:18` `event_bus_enabled = False`；`docker-compose.yml` 未传该变量 |
| 分布式锁 | ⚠️ 有 `WorkerRegistry.acquire_lock` 实现 | ❌ `distributed_lock_enabled = False`，且**当前无任何消费方** | `config.py:22`；`backend/app/core/worker_registry.py:125-142` |

具体表现：

1. **Worker 是死代码。** `run_worker()` 实现了完整的队列消费循环（`claim_next` → `run_task` → `complete/fail`）、`asyncio.Semaphore(worker_concurrency)` 并发控制、`finally` 中 `gather` 收尾 + `close_db()` 优雅退出，但全仓库没有任何编排或脚本会启动它。
2. **默认走 inline，队列只是影子。** `message_hub.py:249` 确实 `enqueue(task)` 落库，但紧接着 `message_hub.py:264-265` 在 `inline` 模式下直接 `self._dispatcher(task.id)` 在 **API 进程内**就地执行。队列记录无人调度。
3. **Redis 起了但没用透。** `docker-compose.yml` 明明起了 `redis:7-alpine` 容器并传了 `REDIS_URL`，但 `EVENT_BUS_ENABLED` / `DISTRIBUTED_LOCK_ENABLED` 一个都没传。Redis 只被 `WorkerRegistry` 心跳那套代码路径引用（而 `build_worker_registry` 在全仓 `app/` 下同样没有调用方），真正的跨实例广播路径从未启用。
4. **本地混合模式同样缺失。** `start-local.bat` 只拉起 backend（uvicorn）与 frontend（npm run dev），没有 Worker 窗口。

### 1.2 问题的本质

**这不是能力缺失，是「最后一公里」问题。**

Worker 进程、Redis 事件总线、跨实例中继（`relay.py` + `distributed.py`）三块代码的质量都不差，实现是完整的。真正把它们锁死在关闭状态的是两样东西：

- **部署编排**：`docker-compose.yml` 只有 `db / redis / backend / frontend` 四个服务，没有 `worker`。
- **默认配置**：三个开关的默认值全部指向"关闭 / 就地执行"，而部署时也无人显式打开。

补上这一公里的成本极低（P0 两项合计不到 50 行配置改动），但**不补，文档里 Phase 2 / Phase 3 那几个「✅ 已达成」就是假的**。

### 1.3 本轮要解决的问题

- 让 `task_queue_items` 里的记录有真正的消费者，任务调度发生在 API 进程之外。
- 让 `EVENT_BUS_ENABLED` 在生产编排中真正打开，跨实例 WebSocket 广播路径可用。
- 让本地混合模式（`start-local.bat`）与容器编排保持同一套执行语义，避免"本地能跑、compose 跑不了"。
- 提供**明确、可验证的回退路径**：任何一项都能通过环境变量关回去，不引入不可逆变更。

---

## 2. 目标与非目标

### 2.1 目标

- G1：独立 Worker 进程成为一等公民服务，在容器编排与本地脚本中均有启动入口。
- G2：默认执行模式由 `inline` 切换为 `queue`，任务经持久化队列由 Worker 消费，Phase 2 断言成立。
- G3：Redis 事件总线在编排中默认启用，跨实例 WebSocket 广播可用，Phase 3 断言成立。
- G4：分布式锁开关在编排中显式打开，与 Phase 3 文档口径一致（见 §10.4 关于其当前无消费方的说明）。
- G5：本地混合模式（`db/redis 在 Docker，backend/frontend 在宿主`）同样启动 Worker，语义与容器编排一致。
- G6：所有新开关均可通过环境变量回退，`inline` 路径完整保留且可用。
- G7：开关默认值变化后，既有 175 个后端测试无新增失败。

### 2.2 非目标

- N1：不新增队列/租约能力（不实现 `TaskService.renew()`、不做续租协程、不统一两套租约体系），见 §16。
- N2：不改造事件总线的可靠性语义（不引入持久化流、不做断线自动重连），见 §14 R2。
- N3：不引入新的外部依赖（Redis 已是既有依赖，不引入 Celery / RabbitMQ / Kafka）。
- N4：不做 Worker 的水平弹性伸缩编排（`--scale worker=N` 可手动用，但本次不提供自动扩缩容）。
- N5：不改动前端代码。

---

## 3. 用户故事

- US1：作为**运维/部署者**，我希望 `docker compose up` 之后 `docker compose ps` 能看到一个真正在跑的 `worker` 服务，而不是只能从代码里"读"出一个 Worker 实现。
- US2：作为**用户**，我希望发送 `@Agent` 消息后，任务被可靠地执行完成；后端重启不会让正在跑的任务凭空消失（队列持久化 + 租约回收）。
- US3：作为**平台开发者**，我希望任务执行发生在 API 进程之外，这样重启 API、扩容 API 实例都不会打断正在执行的任务，也不会让某个实例被长任务拖死。
- US4：作为**前端用户**，我希望在多副本部署下，不管我的 WebSocket 连到哪个 API 实例，都能实时收到任务状态、步骤、轨迹、Agent 状态与消息的推送，而不是只有"恰好连到正确那台"才收得到。
- US5：作为**本地开发者**，我希望 `start-local.bat` 一键拉起的环境和 compose 编排是同一套执行语义，不用每次手动再开一个终端跑 Worker。
- US6：作为**排障者**，我希望这套新链路出问题时能一键关回去（`inline` + 关闭总线），先恢复服务再排查，而不是被新链路锁死。

---

## 4. 核心概念

### 4.1 执行模式（task_execution_mode）

决定"任务由谁执行"的总开关，取值两种：

| 取值 | 语义 | 执行位置 | 未完成任务恢复 |
|------|------|----------|----------------|
| `queue` | API 只负责 `enqueue`，由独立 Worker 进程 `claim_next` 后执行 | Worker 进程 | Worker 启动时 `TaskService.recover()`；`claim_next` 亦支持租约过期重取 |
| `inline` | API 入队同时就地派发执行（保留作回退与单机调试路径） | API 进程内 | 应用启动时 `recover_unfinished_tasks()`（`main.py:33` 仅 inline 模式调用） |

### 4.2 租约（Lease）

队列项被 Worker 抢占后进入 `leased` 状态，持有 `lease_token` 与 `lease_expires_at`。只有持有效 token 的 Worker 才能 `complete` / `fail` 该条目；租约过期后条目重新变为可被抢占，实现"Worker 失联后任务不丢"。

### 4.3 事件总线（Event Bus）

以 Redis Pub/Sub 为传输层，按 workspace 分频道（`workspace:{id}:events`）广播 WebSocket 事件。每个实例有唯一 `instance_id`，信封中带 `origin_id`；接收侧丢弃 `origin_id == 自身 instance_id` 的信封，避免回声与重复广播。

### 4.4 事件中继（Event Relay）

位于事件总线与本地 `WebSocketManager` 之间的双向桥：本地广播时把事件 `publish` 到总线；总线收到远端事件时调用 `broadcast_to_workspace(..., propagate=False)` 投递给本实例连接的客户端（不会再回灌总线）。

### 4.5 本地混合模式（Local Hybrid）

`db` / `redis` 跑在 Docker，`backend` / `frontend` 跑在宿主机的开发形态 —— 目的是让 Codex CLI 等宿主侧二进制可被 backend 直接调用（`start-local.bat` 的设计初衷）。该模式同样需要 Worker 消费队列。

---

## 5. 方案概述

本次改动**不新增业务能力**，只做三件事：**加编排、翻开关、补文档**，把既有实现接上。

```
                       ┌──────────── docker-compose（新增 worker 服务）────────────┐
                       │                                                          │
  用户 @Agent 消息 ──▶ │ backend(API) ──enqueue──▶ task_queue_items ──claim_next──▶ worker │
                       │      │                        ▲                            │
                       │      │ broadcast_to_workspace │ complete / fail            │ run_task
                       │      ▼                        │                            │
                       │  WS 客户端 ◀── relay ◀── Redis Pub/Sub ────────────────────┘
                       │      ▲          ▲        (workspace:{id}:events)
                       │      │          │
                       │  backend-2 ─────┘（EVENT_BUS_ENABLED=true 后跨实例可达）
                       └──────────────────────────────────────────────────────────┘
```

四个落点：

1. `docker-compose.yml` 新增 `worker` 服务（`command: python -m app.worker`）。
2. `backend/app/core/config.py` 的 `task_execution_mode` 默认值 `inline` → `queue`。
3. `docker-compose.yml` 的 backend 与 worker 环境变量补 `EVENT_BUS_ENABLED` / `DISTRIBUTED_LOCK_ENABLED`。
4. `start-local.bat` 增加拉起 Worker 的步骤；`.env.example` 补齐两个开关变量与中文注释。

---

## 6. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | **`worker` 服务编排**：`docker-compose.yml` 新增独立 `worker` 服务，复用 backend 同一镜像与环境变量，`command: python -m app.worker`，`depends_on` 声明 `db` 与 `redis` 的 `service_healthy` | P0 |
| FR2 | **执行模式切换**：`task_execution_mode` 默认值由 `inline` 改为 `queue`，任务经持久化队列由 Worker 消费；`inline` 分支代码完整保留 | P0 |
| FR3 | **事件总线开关**：backend 与 worker 环境变量注入 `EVENT_BUS_ENABLED`（编排默认 `true`），使 `build_event_relay` 返回真实 `DistributedEventRelay` 而非 `NoopEventRelay` | P0 |
| FR4 | **分布式锁开关**：backend 与 worker 环境变量注入 `DISTRIBUTED_LOCK_ENABLED`（编排默认 `true`），与 Phase 3 文档口径一致（当前为预留开关，见 §10.4） | P1 |
| FR5 | **本地混合模式对齐**：`start-local.bat` 增加拉起 Worker 的独立窗口，使宿主侧 backend 只入队、由 Worker 消费，语义与容器编排一致 | P0 |
| FR6 | **配置可回退**：所有新增开关均支持环境变量覆盖；设置 `TASK_EXECUTION_MODE=inline` 可完整回到 API 进程内执行，设置 `EVENT_BUS_ENABLED=false` 可完整关闭总线回到 `NoopEventRelay`，无需改代码 | P0 |
| FR7 | **配置文档补齐**：`.env.example` 增加 `EVENT_BUS_ENABLED` / `DISTRIBUTED_LOCK_ENABLED` 两个变量及中文注释，并同步更新 `TASK_EXECUTION_MODE` 的注释为"默认 queue" | P1 |
| FR8 | **Worker 进程事件出口**：Worker 进程内注册事件总线发布通道，使其执行任务期间产生的事件（`task.status_changed` / `task.step_changed` / `task.trace_updated` / `agent.status_changed` / `message.created`）能经 Redis 到达 API 实例，再由 relay 投递给 WS 客户端 | **P0（阻断项，见 §14 R1）** |
| FR9 | **行为约束固化**：`queue` 模式下未完成任务恢复由 Worker 启动时的 `TaskService.recover()` 与 `claim_next` 的租约过期重取共同承担；`inline` 模式继续由 `recover_unfinished_tasks()` 承担，两条路径不得互相干扰 | P1 |

> **关于 FR8 的说明**：审查报告 §8 的 P0-1/P0-2 未覆盖此项，但经代码复核这是**启用 queue 模式的阻断项** —— 详见 §14 R1。
> **实施结论：FR8 已在本批实施。** `run_worker()` 在消费循环启动前调用 `build_event_relay(...)` 并 `start()`，退出时 `stop()`；`event_bus_enabled=false` 时返回 `NoopEventRelay`，零 Redis 依赖。故 AC7 / AC8 **不顺延**。

---

## 7. 执行链路设计

### 7.1 队列模式（改动后的默认路径）

1. 用户发消息 → `MessageHub.send_message` 创建 `Task`（`status=PENDING`）→ `TaskService.enqueue(task)` 写入 `task_queue_items`（`status=queued`）。
2. `task_execution_mode == "queue"` → **不再**调用 `self._dispatcher(task.id)`，API 请求立即返回。
3. Worker 主循环 `run_worker()` 每 `worker_poll_interval_seconds`（默认 1s）尝试 `claim_next()`：
   - 命中 → 原子 `UPDATE ... WHERE` 抢占，置 `status=leased`、`attempt_count+1`、写入 `lease_token` 与 `lease_expires_at`。
   - 未命中 → 等待下一轮。
4. Worker 执行 `run_task(task_id)`，受 `asyncio.Semaphore(worker_concurrency)`（默认 2）限流。
5. 执行完成 → `complete(item_id, lease_token)` 置 `completed`；失败 → `fail(...)`，未达 `max_attempts`（默认 3）则回到 `queued` 并延迟 `retry_delay_seconds`（默认 5s）重投，达到则置 `dead`。
6. 执行期间产生的事件经事件总线 → 各 API 实例 relay → WS 客户端（依赖 FR8）。

### 7.2 回退路径（inline）

1. `TASK_EXECUTION_MODE=inline` 时，`message_hub.py:264-265` 在 API 进程内直接派发。
2. 应用启动时 `main.py:33` 调用 `recover_unfinished_tasks()` 恢复上次进程遗留的 PENDING / 租约过期 RUNNING 任务。
3. 无 Worker 进程时功能完全不受影响（与改动前一致）。

### 7.3 事件广播路径（开启总线后）

1. 任一进程调用 `broadcast_to_workspace(ws_id, event)`：
   - 先向**本实例**连接的 WS 客户端投递（`manager.py:63-67`）；
   - `propagate=True` 且已注册 publisher 时，再 `publish` 到 Redis 频道（`manager.py:68-69`）。
2. 其他实例的 relay 订阅 `workspace:*:events`，收到信封后：
   - 丢弃 `origin_id == 自身 instance_id` 的信封（防回声）；
   - 否则 `broadcast_to_workspace(..., propagate=False)` 投递给本实例客户端（不再回灌总线）。
3. `EVENT_BUS_ENABLED=false` 时 `build_event_relay` 返回 `NoopEventRelay`，两条路径均空转，行为等同于改动前。

---

## 8. 数据设计

本次**不新增表、不改表结构**。核心表 `task_queue_items`（`backend/app/models/task_queue.py`）已具备完整租约字段：

| 字段 | 类型 | 说明 | 本次用途 |
|------|------|------|----------|
| `id` | int PK | 队列项主键 | `complete` / `fail` 的定位键 |
| `task_id` | int FK → `tasks.id`，**唯一约束** | 一条任务最多一个队列项 | 保证重复 `enqueue` 幂等 |
| `status` | str(20)，索引 | `queued` / `leased` / `completed` / `dead` | AC4 的观测对象 |
| `priority` | int，索引 | 优先级，`claim_next` 按 `priority DESC, id ASC` 取 | 队列顺序 |
| `attempt_count` | int | 已尝试次数 | 与 `max_attempts` 比对决定是否置 `dead` |
| `max_attempts` | int，默认 3 | 最大重试次数 | 失败重试上限 |
| `timeout_seconds` | int，默认 1800 | 任务超时，`lease_expires_at = now + max(lease_seconds, timeout_seconds)` | 租约长度下界 |
| `available_at` | datetime(tz)，索引 | 可被消费的最早时间 | 失败退避重投 |
| `lease_token` | str(36)，可空，索引 | 租约令牌（UUID），持票者才能终结条目 | 重复消费的唯一防线 |
| `lease_expires_at` | datetime(tz)，可空，索引 | 租约到期时间，过期后条目可被重新抢占 | 失联任务回收 |
| `last_error` | Text，可空 | 最近一次失败原因（截断至 4000 字符） | 排障 |
| `created_at` / `updated_at` | datetime(tz) | 创建 / 更新时间 | 审计 |

**并发安全边界（重要）**：`claim_next`（`task_service.py:68-92`）用带 `WHERE` 条件的原子 `UPDATE` 抢占，靠 `rowcount == 1` 判定成功；`complete` / `fail`（`_finish`、`fail`）的 `WHERE` 中同时校验 `status == 'leased'` **且** `lease_token == 传入 token`。因此多个 Worker 并发时，**同一队列项不会被两个 Worker 同时成功 claim；持旧 token 的 Worker 也无法终结已被回收的条目**。这是本次启用多 Worker 的安全基础。

---

## 9. 部署与配置

### 9.1 容器编排（`docker-compose.yml`）

新增 `worker` 服务，服务总数由 4 个变为 5 个：

| 服务 | 镜像 / 构建 | 命令 | 依赖 | 端口 |
|------|-------------|------|------|------|
| `db` | `postgres:16-alpine` | — | — | 5432 |
| `redis` | `redis:7-alpine` | `redis-server --appendonly yes` | — | 6379 |
| `backend` | build `backend/Dockerfile` | uvicorn（镜像默认 CMD） | db/redis healthy | 8000 |
| **`worker`（新增）** | **同 backend 构建** | **`python -m app.worker`** | **db/redis healthy** | 无 |
| `frontend` | build `./frontend` | `npm` | backend healthy | 3000 |

`worker` 服务要求：

- 与 `backend` 使用**同一 `build` 上下文与 Dockerfile**，保证 `app.worker` 模块可被 `python -m` 加载（`backend/Dockerfile` 以 `/app` 为 `WORKDIR` 并 `COPY backend/app ./app`，`app/worker.py` 存在 ⇒ 满足）。
- 挂载与 backend 一致的 `MODELS_CONFIG_PATH`、`DATABASE_URL`、`REDIS_URL` 及各 Provider Key，否则 Worker 侧无法调用模型。
- 复用 backend 的 `user: "0:0"`（Windows bind-mount 权限规避，注释同 backend，生产应移除并改用 named volume）。
- 共享 `./data/bridges` 挂载，使外部桥接任务目录在 Worker 与 API 之间一致。

### 9.2 环境变量

| 变量 | 默认值（代码） | compose 注入值 | 作用域 | 说明 |
|------|----------------|----------------|--------|------|
| `TASK_EXECUTION_MODE` | `queue`（C-170 后） | 继承默认 | backend | 设 `inline` 即回到 API 进程内执行 |
| `EVENT_BUS_ENABLED` | `False`（代码默认） | `${EVENT_BUS_ENABLED:-true}` | backend + worker | 编排中显式打开；设 `false` 关闭 |
| `DISTRIBUTED_LOCK_ENABLED` | `False`（代码默认） | `${DISTRIBUTED_LOCK_ENABLED:-true}` | backend + worker | 预留开关，当前无消费方（§10.4） |
| `REDIS_URL` | `redis://localhost:6379/0` | `${COMPOSE_REDIS_URL:-redis://redis:6379/0}` | backend + worker | 容器内需指向 `redis` 服务名 |
| `WORKER_CONCURRENCY` | `2` | 可选 | worker | 单 Worker 并发上限（1–64） |
| `WORKER_POLL_INTERVAL_SECONDS` | `1.0` | 可选 | worker | 空队列轮询间隔 |

### 9.3 本地混合模式（`start-local.bat`）

在既有 6 步流程中插入 Worker 拉起步骤，步骤计数改为 7 步：

| 步骤 | 内容 | 改动 |
|------|------|------|
| [1/7] | 生成 `.env` | 不变 |
| [2/7] | Docker 起 db + redis | 不变 |
| [3/7] | 检查 backend 依赖 | 不变 |
| [4/7] | 检查 Codex CLI | 不变 |
| [5/7] | 启动 backend（uvicorn :8000） | 不变 |
| **[6/7]** | **启动 Worker：`start "Agent Console - Worker" /D backend cmd /k ""%PYTHON_BIN%" -m app.worker"`** | **新增** |
| [7/7] | 启动 frontend（npm run dev :3000） | 原 [6/6] |

要求：Worker 窗口标题与 Backend / Frontend 保持同一命名风格，收尾提示中的「Stop」说明同步加上 Worker 窗口。

### 9.4 配置样例（`.env.example`）

```dotenv
# 任务执行模式：queue = 入持久化队列，由独立 Worker 消费（默认，C-170）
#                inline = 在 API 进程内直接执行（回退 / 单机调试路径）
TASK_EXECUTION_MODE=queue

# Redis 事件总线：开启后 WebSocket 事件经 Redis Pub/Sub 跨实例广播
# 多副本部署必须开启；关闭则退化为单实例本地广播
EVENT_BUS_ENABLED=true

# 分布式锁：开启后使用 Redis SETNX 锁协调多实例临界区（当前为预留开关）
DISTRIBUTED_LOCK_ENABLED=true
```

---

## 10. 后端改动

### 10.1 `backend/app/core/config.py`

`task_execution_mode` 默认值 `inline` → `queue`，并补注释说明两种模式语义：

```python
# "queue"  = 任务入持久化队列，由独立 Worker 进程消费（默认，C-170）
# "inline" = 在 API 进程内直接执行（保留作回退与单机调试路径）
task_execution_mode: str = "queue"
```

`event_bus_enabled` / `distributed_lock_enabled` 的**代码默认值保持 `False` 不变** —— 打开动作放在编排层（compose 环境变量），保证不部署 compose 的场景（如 CI、SQLite 单测）行为不变。

### 10.2 `docker-compose.yml`

- 新增 `worker` 服务（§9.1）。
- backend 与 worker 的 `environment` 均补 `EVENT_BUS_ENABLED` / `DISTRIBUTED_LOCK_ENABLED`（§9.2）。

### 10.3 `start-local.bat`

- 步骤计数 6 → 7，插入 Worker 拉起步骤（§9.3）。

### 10.4 关于 `DISTRIBUTED_LOCK_ENABLED` 的诚实说明

该开关目前**只有声明、没有消费方**：全仓 `app/` 下搜索 `distributed_lock_enabled` 只命中 `config.py:22` 一处；`WorkerRegistry.acquire_lock` / `release_lock`（`worker_registry.py:125-142`）已实现，但 `build_worker_registry` 在 `app/` 下同样**没有调用方**，`build_worker_registry` 的 `enabled` 参数由调用方传入而非读该配置。

因此 FR4 的价值是：**在编排层把开关显式打开并文档化，使部署口径与 Phase 3 文档一致，为后续分布式锁接入（C-17x）预留落点**；本次**不改变任何运行时行为**。这一点必须在验收时如实标注，不得声称"分布式锁已启用"。

---

## 11. 安全与合规

| 项 | 要求 |
|----|------|
| 凭据传递 | Worker 复用 backend 的环境变量注入方式，Provider Key 不在 compose 文件内硬编码，一律走 `${VAR}` 从宿主 `.env` 注入 |
| 最小权限 | Worker 不暴露端口、不对外提供 HTTP 服务，仅出网访问 db / redis / LLM Provider |
| 事件内容 | 事件总线上传输的是既有 WebSocket 事件体，不新增字段；事件载荷本身不含凭据（凭据仅存在于环境变量与 `provider_credentials` 信封加密表） |
| 本地混合模式 | Worker 在同一宿主以同一用户运行，不提权；与 backend 共享 `data/bridges` 目录，权限沿用既有约定 |
| 回退安全 | 回退路径（`inline`）不依赖 Redis；`EVENT_BUS_ENABLED=false` 时进程不建立 Redis 连接，Redis 完全不可用时服务仍可单实例运行 |
| 生产提示 | `user: "0:0"` 是 Windows bind-mount 的本地开发规避手段，生产部署应移除并改用 named volume（沿用 backend 既有注释，不在本次改动范围） |

---

## 12. 验收标准（AC）

- **AC1（服务编排）**：在仓库根目录执行 `docker compose up -d --build` 后，`docker compose ps` 输出 **5 个服务**（`db` / `redis` / `backend` / `worker` / `frontend`），其中 `worker` 的状态为 `running` 或 `healthy`，且容器名包含 `worker`。
- **AC2（模块可加载）**：在 backend 镜像/工作目录内执行 `python -c "import app.worker; print(app.worker.run_worker)"` 退出码为 0；`worker` 容器日志中不出现 `ModuleNotFoundError` / `ImportError`。
- **AC3（默认模式）**：不设置 `TASK_EXECUTION_MODE` 环境变量时，`get_settings().task_execution_mode == "queue"`；设置 `TASK_EXECUTION_MODE=inline` 时为 `"inline"`（FR6 双向可验）。
- **AC4（队列被真正消费）**：向会话发送一条 `@Agent` 消息后，查询 `task_queue_items` 表：① 出现对应 `task_id` 的记录；② 执行期间观察到 `status='leased'` 且 `lease_token IS NOT NULL`、`lease_expires_at IS NOT NULL`；③ 任务完成后该记录 `status='completed'` 且 `lease_token IS NULL`。全程 `attempt_count` 不因重复消费而异常累加（同一任务一次执行 `attempt_count` 只 +1）。
- **AC5（执行结果等价）**：queue 模式下 `tasks.status` 依次经过 `pending → running → completed`（或 `failed`），且 `task_steps` / `model_calls` 记录数量与 inline 模式**等价**；任务详情页的步骤、模型调用、轨迹三块内容均正常渲染。
- **AC6（回退有效）**：设置 `TASK_EXECUTION_MODE=inline` 且不启动 Worker 的情况下，发送 `@Agent` 消息后任务能被正常执行完成，`task_queue_items` 中不出现 `leased` 状态记录；功能表现与 C-170 改动前一致。
- **AC7（单实例推送不回退）**：单 backend 实例 + `EVENT_BUS_ENABLED=true` 时，WS 客户端仍能收到 `task.status_changed`、`task.step_changed`、`task.trace_updated`、`agent.status_changed`、`message.created` 五类事件；前端控制台/群聊/任务详情页实时更新无可见回退。
- **AC8（跨实例广播）**：`docker compose up -d --scale backend=2` 起两个 backend 实例，对同一 workspace 建立两个 WS 连接并分别落到不同实例（可通过多次重连或日志 `instance_id` 确认落点）；由实例 A 触发的事件，实例 B 上的 WS 客户端**能收到**；同时客户端收到的同一事件**不重复**（信封 `origin_id == 自身 instance_id` 被丢弃）。
- **AC9（关闭总线无回归）**：`EVENT_BUS_ENABLED=false` 时，本地 WS 推送正常，进程不建立 Redis Pub/Sub 连接；既有 `backend/tests/test_distributed_event_bus.py`（10 例）与 `backend/tests/test_event_relay.py`（11 例）**全部通过**。
- **AC10（配置文档）**：`.env.example` 中含 `EVENT_BUS_ENABLED` 与 `DISTRIBUTED_LOCK_ENABLED` 两个变量及中文注释；`TASK_EXECUTION_MODE` 的注释已更新为说明默认值为 `queue`；三个变量的默认值与 §9.4 样例一致。
- **AC11（本地混合模式）**：执行 `start-local.bat` 后出现名为 `Agent Console - Worker` 的独立窗口且进程存活；在该模式下发送 `@Agent` 消息，任务能被消费并正常完成（不出现"消息发出去但任务永远 pending"）。
- **AC12（测试回归）**：全量后端测试（约 175 个测试函数 / 35 个测试文件）执行后**无新增失败**；因执行模式默认值变化而失败的用例必须在本次一并修正或显式标注。

> **条件验收**：AC7 / AC8 的达成依赖 FR8。若 FR8 不在 C-170 内实施，则 AC7 / AC8 顺延至后续变更，并在变更追踪中把 `queue` 模式标注为"实时推送存在已知缺口"。

---

## 13. 里程碑

| 阶段 | 内容 | 产出 | 对应 AC |
|------|------|------|---------|
| M1 | 编排层新增 `worker` 服务，`task_execution_mode` 默认改 `queue` | compose 5 服务；队列被真实消费 | AC1 / AC2 / AC3 / AC4 / AC5 |
| M2 | 事件总线与分布式锁开关注入 + `.env.example` 补齐 | 跨实例广播可用；配置项自解释 | AC8 / AC10 |
| M3 | Worker 进程事件出口（FR8）与单实例推送验证 | queue 模式下实时推送无回退 | AC7 / AC9 |
| M4 | `start-local.bat` 对齐 + 全量回归 | 本地混合模式语义一致；测试全绿 | AC11 / AC12 |
| M5 | 回退路径验证与文档口径更新 | inline 可回退；Phase 2/3 断言成立 | AC6 |

---

## 14. 风险与应对

### R1（P0，阻断）Worker 进程内的事件广播无出口

**事实**：`queue` 模式下任务在 Worker 进程内执行，`AgentOrchestrator` 调用的是 Worker 自己进程内的 `websocket_manager`（`orchestrator.py:48,90`）。而 `worker.py` 既没有启动 FastAPI、没有 WS 客户端连接，也**没有注册分布式 publisher**（`register_distributed_publisher` 仅在 `DistributedEventRelay.start()` 中调用，而 `main.py:29` 只在 API 应用的 lifespan 里执行）。`broadcast_to_workspace` 的 `propagate` 分支要求 `_distributed_publisher is not None`（`manager.py:68`），因此 **Worker 产生的所有事件会静默丢弃，前端实时推送整体失效**。

**影响**：`task.status_changed` / `task.step_changed` / `task.trace_updated` / `agent.status_changed` / `message.created` 全部收不到 —— 直接击穿 PRD-单任务上下文连续性与执行过程可视化 的 FR8 与 AC6。

**应对（已实施）**：FR8 —— `run_worker()` 在消费循环启动前调用
`build_event_relay(websocket_manager, settings.worker_instance_id, settings.event_bus_enabled)`
并 `await event_relay.start()`，`finally` 分支 `await event_relay.stop()`。
`build_event_relay` 在 `enabled=False` 时返回 `NoopEventRelay`，因此**关闭总线时零 Redis 依赖**，
不引入新的启动前置条件。

**验证方式**：`python -c "import app.worker"` 退出码 0；`worker` 容器日志出现
`Worker event relay started` 且带 `instance_id` 与 `event_bus_enabled` 字段（AC2 / AC7）。

### R2（P1）Redis 不可用时无降级、无重连

**已核实的行为**（不要臆测为"自动降级"）：

- **发布侧**：`DistributedEventRelay.publish` → `RedisDistributedEventBus.publish_workspace_event` 直接 `await redis.publish(...)`，**无 try/except**；异常会向上冒泡穿过 `broadcast_to_workspace`（`manager.py:68-69`）到达调用方（如 `message_hub.py:256`）。好消息是本地客户端的投递发生在 publish **之前**（`manager.py:63-67`），所以本实例用户仍会收到消息，但调用方会拿到异常，可能导致请求失败。
- **订阅侧**：`_relay_loop` → `bus.listen()` 的 `psubscribe` 失败会终止整个 relay task；该 task 无 `add_done_callback`、无重试、无重连，异常未被 retrieve（仅在 GC 时打印 "Task exception was never retrieved"）。**Redis 恢复后本实例不会自动重新订阅**，跨实例推送静默失效直到重启。

**应对**：
1. 短期（本次）：在部署文档与运行手册中明确"事件总线依赖 Redis，Redis 不可用时跨实例推送失效，本实例推送仍可达"，并给出一键关闭方式 `EVENT_BUS_ENABLED=false`（关闭后为 `NoopEventRelay`，零 Redis 依赖）。
2. 中期（C-17x，不在本次范围）：给 `publish` 加异常吞掉 + 计数日志，给 `listen` 加重连退避。

### R3（P1）`inline → queue` 是行为变更

**影响面**：

| 变化点 | inline | queue（改动后默认） |
|--------|--------|---------------------|
| 执行位置 | API 进程内 | Worker 进程 |
| API 重启对任务的影响 | 正在跑的任务随进程消失，靠启动恢复 | 不受影响（依赖 FR8 之外的链路已完整） |
| 未完成任务恢复 | `recover_unfinished_tasks()`（`main.py:33`） | Worker 启动时 `TaskService.recover()` + `claim_next` 租约过期重取 |
| 并发上限 | `MAX_RUNNING_TASKS_PER_WORKSPACE = 3`（入队前闸门，两模式均生效） | 叠加 `WORKER_CONCURRENCY = 2` / 每 Worker |
| 忘记启 Worker 的后果 | — | **任务永远 pending**（最易踩的坑） |

**应对**：FR5 / FR6 双保险 —— 编排与本地脚本都自动拉起 Worker；同时保留 `TASK_EXECUTION_MODE=inline` 的一键回退（AC6、AC3 双向验证）。`start-local.bat` 的结束提示里明确列出 Worker 窗口与"任务卡 pending 先看 Worker 窗口"。

### R4（P1）多 Worker 并发下的重复消费边界

**边界（已核实为安全）**：`claim_next` 用带条件的原子 `UPDATE` 抢占（`rowcount == 1` 才算成功），`complete` / `fail` 的 `WHERE` 同时校验 `status='leased'` 与 `lease_token` —— 多 Worker 并发**不会**重复 claim，持旧 token 也无法终结已回收的条目。

**残余风险**：租约长度取 `max(lease_seconds, timeout_seconds)`，`timeout_seconds` 默认 1800s，`claim_next` 的 `lease_seconds` 默认 60s ⇒ 实际租约 30 分钟。而 `MODEL_REQUEST_TIMEOUT_SECONDS` 默认 60s，多步编排任务存在叠加超过 30 分钟的可能；一旦超时，条目会被重新抢占，**同一任务可能被并发执行两次**（Worker 侧无续租，`orchestrator` 侧另有自己的 `execution_token` 租约体系，两套互不同步）。

**应对（部分已实施）**：续租三件套已在**同批的 C-171** 中落地：

1. `TaskService.renew(item_id, lease_token, lease_seconds)` —— 条件更新 `lease_expires_at`，租约丢失时返回 `False`；
2. `worker._renew_lease(...)` 续租协程 —— 任务执行期间按 `WORKER_LEASE_RENEW_INTERVAL_SECONDS`（默认 30s）续期，租约丢失后自行退出，不再触碰该队列项；
3. `run_worker()` 主循环按 `WORKER_RECOVER_INTERVAL_SECONDS`（默认 60s）调用 `TaskService.recover()` 回收失联租约。

**仍未解决（归入 C-17x）**：两套租约体系并存（`orchestrator.execution_token` 与 `task_queue_items.lease_token` 互不同步）。这是架构级决策，需单独评估"统一到队列租约"还是"删除 orchestrator 侧租约"，不在本批范围。

### R5（P2）`DISTRIBUTED_LOCK_ENABLED` 打开后无实际效果

打开该开关不改变任何运行时行为（§10.4）。风险是**误以为已启用分布式锁**。

**应对**：PRD 与变更追踪中如实标注"预留开关，无消费方"，不得写成"分布式锁已启用"。

### R6（P2）Worker 与 API 的配置漂移

Worker 在 compose 中复制了 backend 的环境变量清单，后续新增配置项时若只改 backend 会漏掉 Worker。

**应对**：在本 PRD §9.2 固定变量清单；后续新增模型/桥接相关配置时，compose 中 backend 与 worker 两段同步修改（建议后续提取 YAML 锚点，不在本次范围）。

---

## 15. 与现有系统的关系

本 PRD 建立在以下**已存在且实现完整**的组件之上，本次不重写任何一块：

| 组件 | 位置 | 本次关系 |
|------|------|----------|
| 独立 Worker 进程 | `backend/app/worker.py` | **由死代码变为被编排启动** |
| 持久化队列服务 | `backend/app/services/task_service.py` | 由"只写不消费"变为有消费者 |
| 队列模型 | `backend/app/models/task_queue.py`（`task_queue_items`） | 不改表结构，字段全部复用 |
| 消息中枢 | `backend/app/core/message_hub.py` | 仅切换 `task_execution_mode` 分支走向 |
| Redis 事件总线 | `backend/app/websocket/distributed.py` | 由 `NoopDistributedEventBus` 切到 `RedisDistributedEventBus` |
| 事件中继 | `backend/app/websocket/relay.py` | 由 `NoopEventRelay` 切到 `DistributedEventRelay`（FR8 需扩展至 Worker 进程） |
| WS 广播管理 | `backend/app/websocket/manager.py` | 不改代码，行为由 publisher 是否注册决定 |
| Worker 注册表 / 锁 | `backend/app/core/worker_registry.py` | 不改代码；`DISTRIBUTED_LOCK_ENABLED` 为预留开关 |
| 执行轨迹广播 | `backend/app/core/execution_trace.py` + `orchestrator.py:_emit_trace_update` | 依赖 FR8 才能在 queue 模式下继续生效 |

**本 PRD 补齐的是**：把上述组件之间**本该连上却从未连上的线接通**，并把开关从"默认关"翻到"编排中默认开"。

---

## 16. 不在本次范围内（Out of Scope）

以下事项均为后续变更（C-171 及之后），**明确排除以避免范围蔓延**：

| 事项 | 来源 | 归属 |
|------|------|------|
| `TaskService.renew()` 续租方法 + Worker 续租协程 + 定时 `recover()` sweep | 审查报告 §1.3 | ✅ **已由 C-171 同批实施**（见 §14 R4） |
| 统一两套租约体系（`orchestrator.execution_token` vs `task_queue_items.lease_token`） | 审查报告 §1.3 / P1-2 | C-17x（架构决策，本批未解决） |
| Antigravity 适配器（全仓 0 行代码） | 审查报告 §2.1 / P2-1 | C-171+ |
| 配额限流由内存计数改为 Redis 固定窗口 / 令牌桶 | 审查报告 §2.3 / P2-2 | C-171+ |
| CI 增加 `services: postgres:16` + `redis:7` 的 PG job、前端测试接入 CI | 审查报告 §5 / P1-4 | C-171+ |
| 前端消费 `workspace.snapshot` 事件、断线重连后状态对账 | 审查报告 §2.2 / P1-3 | C-171+ |
| 事件总线的发布异常吞没 + 订阅重连退避（R2 中期方案） | §14 R2 | C-17x |
| compose `user: "0:0"` 生产化治理（改 named volume） | 审查报告 §6 | 部署专项 |
| 遗留 db 文件清理与 `.gitignore` | 审查报告 §6 / P2-3 | 卫生专项 |
| Worker 自动水平扩缩容 | §2.2 N4 | 未排期 |
| 事件总线持久化（Redis Stream / 消息回溯） | §2.2 N2 | 未排期 |

---

## 17. 结论

这次改动的价值不在于写了多少代码，而在于**让已经写好的代码真正跑起来**。

一个从未被启动的 Worker 进程、一条从未被打开的 Redis 通道 —— 它们让文档里 Phase 2 / Phase 3 的三个「✅ 已达成」变成了空头支票。补上这一公里只需要几十行编排与配置，但补上之后，"实现了独立 Worker 进程""支持多实例 WebSocket 实时推送"这两句话才第一次可以被理直气壮地说出口。

同时必须诚实：启用不等于完善。Redis 不可用时的降级（R2）、两套租约并存的架构债（R4 残余）、以及那个打开也不生效的分布式锁开关（R5），都是这次"接通"之后才暴露出来的真实边界。把它们写清楚、排进后续变更，比假装它们不存在更有价值。

其中 R1（Worker 侧事件出口）与 R4（长任务续租）在复核后判定为**启用 queue 模式的阻断项与高危缺陷**，已分别由 FR8 与同批的 C-171 一并修复 —— 这不是范围蔓延，而是"接通"动作本身必须付的代价：不修，queue 模式就是个会让前端实时推送整体失效的回退。

**一句话总结本次改动的判据**：`docker compose up` 之后有一个活的 Worker，`@Agent` 消息会走完 `queued → leased → completed`，两台 backend 能互相听见对方的事件 —— 而任何一个开关都能一键关回去。

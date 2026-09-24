# PRD：弹性 Worker 实例注册与健康探针（FR15）

> 类型：新需求（Requirement） ｜ 状态：已实施 ｜ 登记：变更追踪表 C-216

---

## 1. 背景与问题

`core/worker_registry.py` 早已实现基于 Redis 心跳的 Worker 实例注册（`start`/`list_workers`/分布式锁），但**从未被 Worker 进程接线**：`worker.py` 只启动事件中继，不注册实例心跳，导致「当前有几个 Worker 存活」这一弹性扩缩容的基础观测完全缺失。同时健康面只有 `/health`（进程级），**没有编排器习惯的 `/healthz` 探针**，也没有任何暴露存活实例的端点（报告 REQ-B8：缺 `/healthz` 与实例表）。

## 2. 目标与非目标

**目标**
- G1：Worker 启动时注册实例心跳（Redis，含角色/并发度），优雅退出时注销。
- G2：新增 `/healthz` 存活探针（零外部依赖，供编排器高频调用）。
- G3：新增 `/healthz/workers` 实例列表端点，返回存活 Worker 实例与数量，作为后续自动扩缩容的观测输入。
- G4：事件总线关闭或 Redis 不可用时全部降级，不抛错、不影响主流程。

**非目标**
- N1：不实现自动扩缩容控制器（仅预留观测/探针能力）。
- N2：不新增数据库表或列（实例事实源是 Redis，非 DB）。
- N3：不改动任务调度语义。

## 3. 用户故事

- US1：运维在 `kubectl` 探针里配置 `/api/v1/healthz`，进程存活即 200，不因 DB/Redis 抖动而误杀。
- US2：工程师调用 `/api/v1/healthz/workers` 看到当前存活 Worker 数量与实例信息，判断是否需要扩容。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | `worker.py` 启动时 `build_worker_registry(...).start(extra_info={role, concurrency})` 注册实例心跳；`event_bus_enabled=False` 时用 Noop，零 Redis 依赖 | P0 |
| FR2 | Worker 退出（finally）时 `registry.stop()` 注销心跳 | P0 |
| FR3 | 新增 `GET /api/v1/healthz`：返回 `{status:"ok", service}`，零外部依赖 | P0 |
| FR4 | 新增 `GET /api/v1/healthz/workers`：返回 `{status, count, workers:[...]}`，best-effort，Redis 异常降级为空 | P0 |
| FR5 | `/healthz` 加入鉴权中间件 public_paths（探针可不带凭证） | P1 |

## 5. 非功能需求（NFR）

- **健壮性**：探针端点不抛异常；Redis 不可用只记 warn 并返回空列表。
- **性能**：`/healthz` 不触碰 DB/Redis，可高频调用。
- **兼容**：不新增表/列、不改任务语义；`event_bus_enabled=False` 行为与现状一致。
- **可观测**：实例心跳携带 `instance_id`/`registered_at`/`last_heartbeat_at`/`role`/`concurrency`。

## 6. 验收标准（AC）

- AC1：`GET /api/v1/healthz` 返回 200 且 `status=="ok"`。
- AC2：`GET /api/v1/healthz/workers` 返回 200，`count` 为整数，`workers` 为列表；事件总线关闭时为 `[]`。
- AC3：Worker 正常启动注册心跳、退出注销（代码审查 + 现网 Redis 键验证）。
- AC4：Redis 不可用时 `/healthz/workers` 仍 200（降级空列表）。
- AC5：`pytest backend/tests/test_health.py` 全绿；CI 同参数 flake8 0 错误。

## 7. 数据与配置模型

无新表。实例事实源为 Redis 键：

- `agent_console:worker:heartbeat:{instance_id}`：心跳（SETEX，TTL=`worker_lease_timeout`）。
- `agent_console:worker:info:{instance_id}`：实例信息 Hash（instance_id/registered_at/last_heartbeat_at/role/concurrency）。

配置项复用既有：`REDIS_URL`、`EVENT_BUS_ENABLED`、`WORKER_INSTANCE_ID`、`WORKER_LEASE_TIMEOUT`。

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | worker.py 注册/注销实例心跳 | ✅ 完成 |
| M2 | `/healthz` 与 `/healthz/workers` 端点 | ✅ 完成 |
| M3 | 鉴权白名单放行 `/healthz` | ✅ 完成 |
| M4 | 单测 + CI 同参数 flake8 | ✅ 完成 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-216 | 已完成 | 待填 | LI | Requirement | 后端 | Worker 实例心跳注册与 /healthz、/healthz/workers 健康探针，为弹性扩缩容预留观测能力 | - | worker.py 接线 WorkerRegistry；endpoints/health.py 新增探针；main.py public_paths 放行 /healthz；tests/test_health.py 新增用例 | 否 | 否 | test_health.py + test_worker_registry.py 21 passed；flake8 0 | PRD: docs/prd/PRD-弹性Worker实例与健康探针.md |

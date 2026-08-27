# PRD：PostgreSQL 迁移与 Alembic 迁移治理

> 类型：新需求（Requirement）｜状态：已完成（2026-08-21 上线，C-140 / 18fb247；生产默认 PostgreSQL + Alembic 治理）｜目标：引入 Alembic 做可审计的 schema 演进，并将领域事实源从 SQLite 迁移至 PostgreSQL，为后续 TaskService 拆分、独立 Worker 与事件总线提供可靠的持久化底座。

---

## 1. 背景与问题

项目当前以 SQLite（`sqlite+aiosqlite`）作为领域事实源，建表与 schema 演进采用 `Base.metadata.create_all` + 手写补列（`_migrate_sqlite_schema`）的方式。架构治理基线（`docs/架构治理基线.md`）在风险清单中明确指出两个待解决项：

- **R-02**：SQLite 并发写与锁竞争，高并发下吞吐下降、提交冲突。后续动作标注为"Phase 1 / 数据库阶段引入 Alembic 并迁移 PostgreSQL"。
- **R-07**：`create_all` + SQLite 手写补列，schema 演进不可审计、PostgreSQL 不适用。后续动作标注为"引入 Alembic，禁止继续扩展手写补列方案"。

此外，演进边界图（第 6 节）的强制边界第 4 条明确："领域状态以 PostgreSQL 为事实源；Redis/NATS 与 WebSocket 都不是事实源"。后续 TaskService、持久化队列、Outbox 事件均依赖 PostgreSQL 先落地，本迁移是整个 Phase 0 演进依赖链的底座。

### 当前实现现状（事实依据）

| 维度 | 现状 |
|---|---|
| 引擎创建 | `app/db/session.py:18` `create_async_engine(settings.database_url)`，无连接池参数 |
| 建表机制 | `app/db/session.py:38` `Base.metadata.create_all` + 第 39 行 `_migrate_sqlite_schema` 手写补列 |
| 手写补列 | `app/db/session.py:42-55` 针对 `tasks` 表补 `execution_token` / `execution_token_expires_at` 两列 |
| SQLite 专属逻辑 | `app/db/session.py:22-27` `PRAGMA foreign_keys=ON` 事件监听 |
| 数据库 URL | `app/core/config.py:15` 默认 `sqlite+aiosqlite:///./data/agent_console.db`；`docker-compose.yml:30` 硬编码同值 |
| 依赖 | `requirements.txt` 只有 `aiosqlite`，无 `alembic`、无 `asyncpg` |
| Dockerfile | 只 COPY `backend/app` 与 `config`，无 alembic 目录 |
| 模型层 | 19 张表（含 integration_nodes），枚举全 `native_enum=False`（PG 兼容），无 SQLite 专属语法硬伤 |
| JSON 字段 | 用 `Text` 存手写 JSON 字符串（integration_nodes / plugin / workflow），未用原生 JSONB |
| 测试建库 | 25 个测试文件各自 `create_async_engine` + `create_all` 自建临时 sqlite，无 conftest.py |
| Alembic 痕迹 | 全仓无 alembic.ini、无 versions/、无 alembic 依赖 |

---

## 2. 目标与非目标

### 2.1 目标

- **G1 引入 Alembic**：建立 `alembic.ini` + `backend/alembic/` 目录（env.py / script.py.mako / versions/），用 `alembic revision --autogenerate` 生成基线迁移脚本，schema 演进从此可审计、可回滚。
- **G2 迁移至 PostgreSQL**：新增 `db` 服务（`postgres:16-alpine`），DATABASE_URL 默认值改为 `postgresql+asyncpg://agent:agent@db:5432/agent_console`，依赖新增 `asyncpg`。
- **G3 下线 create_all 与手写补列**：`init_db()` 不再调用 `create_all` 和 `_migrate_sqlite_schema`；建表由 `alembic upgrade head` 驱动；lifespan 启动时自动执行 upgrade。
- **G4 引擎连接池**：PG 下为引擎配置 `pool_size` / `pool_pre_ping` / `pool_recycle`，移除 SQLite 专属 PRAGMA 逻辑。
- **G5 数据迁移**：提供从旧 SQLite 库导出数据并导入 PostgreSQL 的迁移脚本/指南，保证现有种子数据与运行时数据不丢失。
- **G6 测试策略**：引入 `backend/tests/conftest.py` 共享 fixture，测试继续用临时 sqlite + `create_all` 保证速度，同时新增一组验证 Alembic 迁移正确性的冒烟测试。

### 2.2 非目标

- **N1**：不改造 JSON 字段为 JSONB（保持 `Text` 存 JSON 字符串，避免扩大范围；列为后续可选优化）。
- **N2**：不改造 `String(36)` token 为原生 UUID 类型（保持兼容，列为后续可选优化）。
- **N3**：不抽离 TaskService、不引入持久化队列、不改造事件总线（这些是后续独立 Requirement）。
- **N4**：不做生产级高可用配置（流复制、读写分离等）。

---

## 3. 用户故事

- **US1（开发者）**：作为开发者，我希望 schema 变更通过 Alembic 迁移脚本管理，这样每次表结构变更都有可审计的 revision，可追溯、可回滚，不再依赖手写补列。
- **US2（运维）**：作为运维，我希望后端连接 PostgreSQL 而非 SQLite，这样高并发场景下不再有写锁竞争，为多实例部署打好底座。
- **US3（开发者）**：作为开发者，我希望 `docker compose up` 能自动拉起 PostgreSQL 并执行迁移，这样本地环境一键就绪。
- **US4（开发者）**：作为开发者，我希望测试依然用临时 sqlite 保证速度，同时有迁移正确性的冒烟测试，这样不会因迁移改造导致测试回归。

---

## 4. 功能需求（FR）

### FR1：Alembic 初始化

- `backend/alembic.ini`（配置 sqlalchemy.url 占位、script_location 指向 `backend/alembic`）。
- `backend/alembic/env.py`：从 `app.core.config.get_settings()` 读取 DATABASE_URL（而非 alembic.ini 硬编码），支持 sync 和 async 两种运行方式；import `app.models` 注册全部模型元数据。
- `backend/alembic/script.py.mako`：标准模板。
- `backend/alembic/versions/`：基线迁移脚本（`alembic revision --autogenerate` 生成，覆盖全部 19 张表）。

### FR2：PostgreSQL 服务与依赖

- `docker-compose.yml` 新增 `db` 服务：`postgres:16-alpine`，持久化 volume `postgres_data`，healthcheck `pg_isready`。
- backend 服务的 `DATABASE_URL` 改为 `${DATABASE_URL:-postgresql+asyncpg://agent:agent@db:5432/agent_console}`，`depends_on` 加 `db`（`condition: service_healthy`）。
- `backend/requirements.txt` 新增 `alembic>=1.13,<2.0`、`asyncpg>=0.29,<1.0`（生产驱动）。
- `backend/Dockerfile` COPY `backend/alembic` 与 `backend/alembic.ini` 进镜像。

### FR3：引擎与会话改造

- `app/db/session.py`：`create_async_engine` 按 URL scheme 判断——PG 下配置连接池参数（`pool_size=10, pool_pre_ping=True, pool_recycle=1800`）；SQLite 专属 PRAGMA 监听仅在 URL 以 `sqlite` 开头时注册。
- `app/core/config.py`：`database_url` 默认值改为 `postgresql+asyncpg://agent:agent@db:5432/agent_console`。
- `init_db()` 移除 `create_all` 与 `_migrate_sqlite_schema` 调用；改为在 lifespan 中执行 `alembic upgrade head`（通过 `subprocess` 或 `alembic.command` API 调用）。

### FR4：数据迁移

- 提供 `backend/scripts/migrate_sqlite_to_pg.py` 脚本：读取旧 SQLite 库全表数据，按依赖顺序导入 PostgreSQL（先无外键依赖的表，后有关联的表）。
- 迁移脚本支持 `--dry-run` 预检模式，先报告将迁移的表与行数。
- 迁移完成后校验：对比源库与目标库的表行数，输出差异报告。

### FR5：测试策略

- 新增 `backend/tests/conftest.py`：提供 `db_engine` / `db_session` 共享 fixture（临时 sqlite + `create_all`），减少重复样板代码。
- 新增 `backend/tests/test_alembic_migrations.py`：验证迁移脚本可正确执行（`alembic upgrade head` 在空库上建出全部表）、`downgrade` 可回退、autogenerate 无遗漏变更。
- 现有 25 个测试文件逐步改用 conftest 的共享 fixture（本轮至少迁移 `test_external_mention.py`、`test_database.py` 作为示范）。

### FR6：SQLite 回退兼容（过渡期）

- 引擎层保留 SQLite scheme 判断，使本地无 Docker 环境的开发者仍可用 sqlite 跑（DATABASE_URL 指向 sqlite 即走原路径，但不走 `create_all`，改由 alembic upgrade）。
- alembic env.py 对 sqlite 和 pg 生成兼容的 DDL（不使用 PG 专属类型）。

---

## 5. 验收标准（AC）

- **AC1**：`docker compose up` 能拉起 `db`（postgres healthy）和 `backend`，backend 启动时自动执行 `alembic upgrade head`，日志无错误，健康检查通过。
- **AC2**：`alembic revision --autogenerate` 在无变更时生成的迁移脚本为空（无遗漏），证明基线迁移与模型完全同步。
- **AC3**：`alembic upgrade head` 在空 PostgreSQL 上建出全部 19 张表，字段、索引、约束与模型定义一致。
- **AC4**：`alembic downgrade base` 可干净回退（全部表删除）。
- **AC5**：后端全量测试通过（`pytest backend/tests`），`test_alembic_migrations.py` 新增的迁移正确性测试通过。
- **AC6**：前端 `npm run build` + `npm test` + `npm run lint` 全通过（无回归）。
- **AC7**：数据迁移脚本 `migrate_sqlite_to_pg.py --dry-run` 能正确报告源库表与行数；实际迁移后行数一致。
- **AC8**：连接池参数生效（PG 下引擎配置包含 pool_size / pool_pre_ping / pool_recycle）。

---

## 6. 数据模型

本迁移不新增表、不修改字段语义。涉及的 19 张表清单见 `HANDOFF.md` 第 2 节（含 integration_nodes）。

迁移脚本需保证：
- 主键在 PG 下生成为 `SERIAL` / `IDENTITY`（SQLAlchemy 默认行为，无需显式声明）。
- 枚举字段保持 `native_enum=False`（VARCHAR + CHECK 约束，不建 PG 原生 enum 类型）。
- 外键 `ondelete` 策略（CASCADE / SET NULL）PG 完整支持。
- JSON 字段保持 `Text` 类型（N1 非目标，后续优化）。

---

## 7. 前端

本轮无前端改动。

---

## 8. 后端

| 文件 | 改动 |
|---|---|
| `backend/alembic.ini` | 新增 |
| `backend/alembic/env.py` | 新增（从 settings 读 URL，注册模型元数据） |
| `backend/alembic/script.py.mako` | 新增 |
| `backend/alembic/versions/0001_baseline.py` | 新增（基线迁移，19 张表） |
| `backend/app/db/session.py` | 移除 create_all / _migrate_sqlite_schema；PG 连接池配置；PRAGMA 仅 sqlite 注册 |
| `backend/app/core/config.py` | database_url 默认值改 PG |
| `backend/app/main.py` | lifespan 改为执行 alembic upgrade head |
| `backend/requirements.txt` | 新增 alembic、asyncpg |
| `backend/Dockerfile` | COPY alembic 目录与 alembic.ini |
| `backend/scripts/migrate_sqlite_to_pg.py` | 新增（数据迁移脚本） |
| `backend/tests/conftest.py` | 新增（共享 fixture） |
| `backend/tests/test_alembic_migrations.py` | 新增（迁移正确性测试） |
| `backend/tests/test_external_mention.py` | 改用 conftest 共享 fixture |
| `backend/tests/test_database.py` | 改用 conftest 共享 fixture |
| `docker-compose.yml` | 新增 db 服务；backend DATABASE_URL 改 PG；depends_on db |

---

## 9. 安全

- PostgreSQL 使用非默认凭证（`agent` / 随机密码），生产部署应通过 `.env` 或 secrets 注入。
- 数据迁移脚本不记录敏感数据，日志只输出表名与行数。
- 迁移脚本具备幂等性（重复执行不报错，已存在数据跳过）。

---

## 10. 里程碑

| 里程碑 | 交付物 | 依赖 |
|---|---|---|
| M1 Alembic 初始化 | alembic.ini / env.py / 基线迁移脚本 | 无 |
| M2 PG 服务与依赖 | docker-compose db 服务 / requirements / Dockerfile | M1 |
| M3 引擎与 session 改造 | session.py / config.py / main.py lifespan | M1, M2 |
| M4 测试策略 | conftest.py / test_alembic_migrations.py / 改造示范测试 | M1, M3 |
| M5 数据迁移脚本 | migrate_sqlite_to_pg.py | M3 |
| M6 验收与推送 | 全量测试通过 + 子 Agent 独立验收 | M1-M5 |

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 基线迁移脚本与模型不同步 | `autogenerate` 生成后人工核对，确保无遗漏列与约束 |
| lifespan 中 alembic upgrade 失败导致启动阻塞 | 捕获异常并明确报错日志，开发期快速失败 |
| 数据迁移中外键约束冲突 | 按依赖顺序导入，支持 `--dry-run` 预检 |
| 本地无 Docker 开发者 sqlite 回退断裂 | FR6 保留 sqlite scheme 判断，alembic 对 sqlite 兼容 |

---

## 12. 系统关系

- **上游约束**：`docs/架构治理基线.md`（R-02 / R-07 / 演进边界图强制边界第 4 条）。
- **下游解锁**：TaskService 拆分（R-03）、持久化队列与独立 Worker（R-01）、事件总线与 Outbox（R-04 / R-08）均依赖本迁移完成。
- **相关 PRD**：`PRD-Phase2持久化任务队列与独立Worker.md`（Worker 侧）、`PRD-Phase3分布式化.md`（事件总线侧）。

---

## 13. 开放问题

- Q1：PG 凭证默认用 `agent/agent` 还是首次启动随机生成并写入 `.env`？（倾向：开发默认固定值，生产强制 secrets 注入）
- Q2：是否在 Dockerfile 构建阶段执行 `alembic upgrade head`？（倾向：否，运行时 lifespan 执行，构建期无 DB 连接）

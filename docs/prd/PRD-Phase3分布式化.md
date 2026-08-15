# PRD：Phase 3 分布式化

> 类型：新需求（Requirement）｜状态：已完成｜对应《项目计划》Phase 3 分布式化。

---

## 1. 目标

将系统从"单进程内协作"升级为"可跨实例协作、可水平扩展、可恢复"的分布式执行平台。

核心目标：
- 支持多实例部署下的实时事件广播
- 解耦 WebSocket 连接层与事件分发层
- 实现 Worker 集群化运行
- 保证跨进程场景下的状态一致性与故障恢复

---

## 2. 用户故事

- 作为运维人员，我希望可以水平扩展 Worker 实例来应对高并发任务，而不需要修改业务代码
- 作为用户，我希望在多实例部署下，WebSocket 消息仍然能实时可靠地推送到前端
- 作为开发者，我希望事件分发与连接管理有明确的边界，便于独立扩展和排障
- 作为系统管理员，我希望能快速定位跨进程场景下的消息丢失或任务重复执行问题

---

## 3. 功能需求（FR）

### 3.1 事件总线层

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR1 | 引入 Redis Pub/Sub 或 NATS 作为跨进程事件总线，统一承载任务状态变更、消息广播、心跳与系统通知 | P0 |
| FR2 | 定义统一事件模型，明确事件类型、payload 结构、幂等键、顺序要求与过期策略 | P0 |
| FR3 | 事件总线支持发布/订阅、重试、死信与告警能力 | P0 |
| FR4 | 事件总线接入 trace_id / task_id / conversation_id 全链路关联 | P0 |

### 3.2 连接网关层

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR5 | WebSocket 连接管理与事件分发解耦，连接层不直接依赖业务内存状态 | P0 |
| FR6 | 支持 WebSocket 断线重连后的状态快照同步 | P0 |
| FR7 | 连接层按 workspace_id 管理连接，支持单播与广播 | P0 |
| FR8 | 连接层支持健康检查与连接统计指标 | P1 |

### 3.3 任务执行层

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR9 | Worker 支持集群化部署，多个 Worker 实例并行消费任务 | P0 |
| FR10 | 建立任务租约、续租与失联回收机制，避免实例宕机后任务永久挂起 | P0 |
| FR11 | Worker 通过事件总线接收任务状态变更通知 | P0 |
| FR12 | 支持 Worker 热重启与优雅关闭 | P1 |

### 3.4 状态同步层

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR13 | 统一处理任务状态、消息状态、Agent 状态的跨进程广播与落库 | P0 |
| FR14 | 建立跨进程状态对账与重放能力，保证最终一致性 | P0 |
| FR15 | 为后续弹性扩缩容预留实例注册、健康检查和流量感知能力 | P1 |

---

## 4. 非功能需求（NFR）

| 编号 | 需求 | 优先级 |
|---|---|---|
| NFR1 | 事件广播延迟 < 100ms（同机房） | P0 |
| NFR2 | 事件丢失率 < 0.01% | P0 |
| NFR3 | 支持至少 1000 个并发 WebSocket 连接 | P0 |
| NFR4 | 支持至少 10 个并发 Worker 实例 | P0 |
| NFR5 | 单实例重启后，未完成任务可在 30 秒内被其他实例接管 | P0 |
| NFR6 | 多 Worker 同时运行时，任务不会被重复消费或重复完成 | P0 |

---

## 5. 数据模型

### 5.1 事件模型

新增事件消息结构：
```python
# 事件类型枚举
EventType = Literal[
    "message.created",
    "agent.status_changed", 
    "task.status_changed",
    "task.step_changed",
    "model.call_finished",
    "error",
    "workspace.snapshot",  # 新增：工作区状态快照
    "system.heartbeat",   # 新增：系统心跳
]

# 统一事件 payload 结构
class DistributedEvent(TypedDict):
    type: EventType
    payload: Any
    trace_id: str          # 全链路追踪 ID
    task_id: int | None    # 关联任务 ID
    conversation_id: int | None  # 关联会话 ID
    workspace_id: int      # 工作区 ID
    timestamp: datetime    # 事件发生时间
    idempotent_key: str    # 幂等键，防止重复处理
    version: str = "1.0"   # 事件版本
```

### 5.2 实例注册表

新增 `worker_instances` 表（如使用数据库存储实例状态）：
```python
class WorkerInstance(Base):
    __tablename__ = "worker_instances"
    
    id: int = Column(Integer, primary_key=True, autoincrement=True)
    instance_id: str = Column(String(64), unique=True, nullable=False)  # 实例唯一标识
    host: str = Column(String(255))  # 机器 hostname
    pid: int = Column(Integer)  # 进程 ID
    status: str = Column(String(32), default="running")  # running/stopped/failed
    registered_at: datetime = Column(DateTime, default=utc_now)
    last_heartbeat_at: datetime = Column(DateTime, default=utc_now)
    concurrent_tasks: int = Column(Integer, default=0)  # 当前并发任务数
    workspace_id: int | None = Column(Integer, ForeignKey("workspaces.id"))  # 可选：绑定工作区
```

### 5.3 分布式锁表

新增 `distributed_locks` 表（用于分布式场景下的互斥锁）：
```python
class DistributedLock(Base):
    __tablename__ = "distributed_locks"
    
    id: int = Column(Integer, primary_key=True, autoincrement=True)
    lock_key: str = Column(String(255), unique=True, nullable=False)  # 锁键值
    owner_instance_id: str = Column(String(64))  # 持有者实例 ID
    acquired_at: datetime = Column(DateTime, default=utc_now)
    expires_at: datetime = Column(DateTime)  # 过期时间
    version: int = Column(Integer, default=1)  # 版本号，用于 CAS 操作
```

---

## 6. 后端方案

### 6.1 事件总线实现

**技术选型**：优先选择 **Redis Pub/Sub**
- 理由：简单、成熟、社区支持好，与现有技术栈兼容性佳
- 备选：NATS（更高性能，但运维复杂度更高）

**实现架构**：
```
┌─────────────────────────────────────────────────────────┐
│                    事件总线层 (Redis)                         │
├─────────────────────────────────────────────────────────┤
│  Channel: workspace:{workspace_id}::events                 │
│  Channel: system::heartbeat                                  │
│  Channel: system::worker_registry                           │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────┐    ┌─────────────────────┐
│   连接网关层         │    │   任务执行层         │
│   (WebSocket)        │    │   (Worker)          │
└─────────────────────┘    └─────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│                    状态同步层                                  │
│  - 事件订阅与分发                                          │
│  - 状态缓存与对账                                          │
│  - 快照同步与恢复                                          │
└─────────────────────────────────────────────────────────┘
```

**核心组件**：

1. **EventBus（事件总线客户端）**
   - `publish(event_type, payload, workspace_id, trace_id, ...)`
   - `subscribe(channel_pattern, handler)`
   - `unsubscribe(channel_pattern, handler)`

2. **EventDispatcher（事件分发器）**
   - 订阅 Redis 频道
   - 按 workspace_id 分发事件到对应的连接
   - 处理幂等、重试、死信

3. **ConnectionGateway（连接网关）**
   - 管理 WebSocket 连接
   - 不再直接持有业务状态
   - 从事件分发器接收事件并推送到前端

4. **WorkerRegistry（Worker 注册中心）**
   - 管理 Worker 实例注册与注销
   - 健康检查与心跳
   - 负载均衡与任务分配

### 6.2 关键实现细节

**事件幂等处理**：
- 每个事件生成唯一的 `idempotent_key`
- 连接层/Worker 层维护已处理事件的缓存（TTL 24小时）
- 重复事件直接丢弃或返回已处理结果

**事件顺序保证**：
- 为每个 conversation_id 维护事件序列号
- 事件 payload 包含 `sequence_num`
- 接收方按序列号排序处理，跳过已处理的旧事件

**状态对账机制**：
- 定期（每 60 秒）发送工作区状态快照事件
- 连接层/Worker 层接收快照后对账本地状态
- 发现不一致时触发重新同步

**Worker 租约机制**：
- Worker 启动时注册实例信息
- 每 30 秒发送心跳更新 `last_heartbeat_at`
- 如 90 秒未收到心跳，标记为失联
- 失联 Worker 的任务自动回收到队列

### 6.3 迁移策略

**阶段 1：准备阶段**
- 引入 Redis 依赖与配置
- 实现 EventBus 基础客户端
- 保持现有进程内事件广播不变

**阶段 2：双写阶段**
- 事件同时发布到进程内与 Redis
- 连接层同时监听进程内与 Redis 事件
- 通过配置开关控制是否启用 Redis 事件

**阶段 3：切换阶段**
- 关闭进程内事件广播
- 全部切换到 Redis 事件总线
- 保留回滚能力

**阶段 4：清理阶段**
- 移除进程内事件广播代码
- 完成冒烟测试与性能验证

---

## 7. 前端方案

前端主要变化在 WebSocket 连接管理：

**连接层改造**：
- WebSocket 连接不再绑定到特定 API 实例
- 支持连接到任意可用的 API 实例
- 断线重连时自动重新订阅所有工作区事件

**状态同步**：
- 连接建立后自动请求工作区状态快照
- 收到快照后与本地状态对账
- 发现缺失的任务/消息时请求补全

**用户体验**：
- 连接状态指示器显示当前连接的实例
- 多实例部署下，用户感知仍为单一连接

---

## 8. 验收标准（AC）

### 8.1 功能验收

| 编号 | 验收标准 | 验证方法 |
|---|---|---|
| AC1 | 单个实例重启后，未完成任务可由其他实例在 30 秒内接管 | 杀死一个 Worker，观察任务是否被其他 Worker 接管 |
| AC2 | 多个 Worker 同时运行时，任务不会被重复消费或重复完成 | 启动多个 Worker，提交任务，检查任务执行次数 |
| AC3 | WebSocket 断线重连后，前端可在 5 秒内重新同步最新任务状态与消息状态 | 断开 WebSocket，重新连接，检查前端显示 |
| AC4 | 事件广播在跨进程场景下仍能稳定送达，且可定位丢失原因 | 多实例部署，检查所有实例是否收到事件 |
| AC5 | 通过健康检查、日志与指标可快速判断某个实例是否异常 | 查看健康检查端点、日志、指标面板 |
| AC6 | 事件重复投递时，前端不会显示重复消息 | 手动重放事件，检查前端是否去重 |
| AC7 | 多实例下，任务状态变更仍能实时推送到前端 | 多实例部署，执行任务，检查前端是否实时更新 |

### 8.2 性能验收

| 编号 | 验收标准 | 验证方法 |
|---|---|---|
| AC8 | 事件广播延迟 < 100ms（同机房） | 测量事件发布到接收的时间差 |
| AC9 | 支持至少 1000 个并发 WebSocket 连接 | 压力测试，检查连接稳定性 |
| AC10 | 支持至少 10 个并发 Worker 实例 | 启动 10 个 Worker，检查任务分配 |
| AC11 | 单实例重启恢复时间 < 10 秒 | 重启实例，测量恢复时间 |

---

## 9. 里程碑

| 编号 | 里程碑 | 交付物 | 预计工期 |
|---|---|---|---|
| M1 | 事件总线方案选型与事件协议草案 | EventBus 基础客户端、事件模型定义 | 3 天 |
| M2 | WebSocket 连接层与业务事件分发解耦 | ConnectionGateway、EventDispatcher | 5 天 |
| M3 | Worker 集群化与任务租约回收机制 | WorkerRegistry、租约管理、失联回收 | 7 天 |
| M4 | 跨实例消息广播、状态一致性验证与故障演练 | 完整分布式部署、测试、文档 | 5 天 |

---

## 10. 风险与应对

| 编号 | 风险 | 可能性 | 影响 | 应对措施 |
|---|---|---|---|---|
| R1 | 事件重复投递导致前端显示重复消息 | 中 | 高 | 统一幂等键与去重策略，前端按事件 ID 合并渲染 |
| R2 | 事件总线引入后排障复杂度上升 | 高 | 中 | 保留 trace_id / task_id / conversation_id 全链路关联，建立完善日志 |
| R3 | Worker 扩容后出现抢占冲突 | 中 | 高 | 通过租约、原子 claim 和超时回收控制并发边界 |
| R4 | 连接层和事件层解耦后状态同步滞后 | 中 | 中 | 在重连、定时心跳和关键状态变化时强制做一次快照同步 |
| R5 | Redis 单点故障导致系统不可用 | 低 | 高 | 生产环境使用 Redis Sentinel 或 Cluster，开发环境允许降级到进程内模式 |
| R6 | 多实例下时钟不同步导致租约失效 | 低 | 中 | 使用逻辑时钟或 NTP 同步，租约过期时间留足余量 |

---

## 11. 系统关系

**上游依赖**：
- Phase 0：架构治理基线（已完成）
- Phase 1：稳定化（PostgreSQL 迁移中）
- Phase 2：平台化（持久化队列与独立 Worker，已完成）

**下游影响**：
- Phase 4：可观测性（将依赖分布式事件总线）
- Phase 5：产品化（多租户需求将使用分布式基础设施）

**并行工作**：
- 可观测性指标采集可与 P3 并行推进
- 前端交互优化不依赖 P3

---

## 12. 成功标准

P3 完成后，系统应满足：

1. ✅ 单个实例重启后，未完成任务可由其他实例继续接管
2. ✅ 多个 Worker 同时运行时，任务不会被重复消费或重复完成
3. ✅ WebSocket 断线重连后，前端可重新同步最新任务状态与消息状态
4. ✅ 事件广播在跨进程场景下仍能稳定送达，且可定位丢失原因
5. ✅ 能通过健康检查、日志与指标快速判断某个实例是否异常
6. ✅ 事件广播延迟 < 100ms（同机房）
7. ✅ 支持至少 1000 个并发 WebSocket 连接
8. ✅ 支持至少 10 个并发 Worker 实例

---

## 13. 附录

### 13.1 配置项

新增配置项：
```python
# Redis 配置
REDIS_HOST: str = "localhost"
REDIS_PORT: int = 6379
REDIS_PASSWORD: str | None = None
REDIS_DB: int = 0

# 事件总线配置
EVENT_BUS_ENABLED: bool = False  # 是否启用事件总线
EVENT_BUS_TYPE: str = "redis"  # redis/nats

# Worker 配置
WORKER_INSTANCE_ID: str | None = None  # 实例 ID，自动生成
WORKER_HEARTBEAT_INTERVAL: int = 30  # 心跳间隔（秒）
WORKER_LEASE_TIMEOUT: int = 90  # 租约超时（秒）

# 分布式锁配置
DISTRIBUTED_LOCK_ENABLED: bool = False
DISTRIBUTED_LOCK_TIMEOUT: int = 30  # 锁超时（秒）
```

### 13.2 部署拓扑

**开发环境**：
```
┌─────────────┐    ┌─────────────┐
│   API        │    │   Worker     │
│  (FastAPI)   │    │  (Python)    │
└──────┬──────┘    └──────┬──────┘
       │                   │
       ▼                   ▼
┌─────────────────────────────────┐
│        SQLite + Redis            │
│   (可选：启用 Redis 事件总线)    │
└─────────────────────────────────┘
```

**生产环境**：
```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   API #1     │    │   API #2     │    │   Worker #1  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│                    PostgreSQL + Redis                   │
│              (Redis Sentinel/Cluster)                  │
└─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│   Client     │
│  (Browser)   │
└─────────────┘
```

---

*本文档由 2026-08-15 起草，随 P3 实施同步更新。*
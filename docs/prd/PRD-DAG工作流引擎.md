# PRD：DAG 工作流引擎

> 类型：Requirement ｜ 状态：已实施 ｜ 登记：变更追踪表 C-186

---

## 1. 背景与问题

工作流模板（`workflow_templates` 表，`nodes_json` 存节点数组）的执行在
`backend/app/api/v1/endpoints/workflows.py` 的 `run_workflow_template` 中，
旧实现把所有节点「压成一段 prompt」交给单 Agent 跑：节点间没有真正的依赖
编排，无法并行、无法按节点追溯执行进度、单点失败即整单失败且不可观测。
节点数组里已声明 `dependencies` 字段但从未被消费。

## 2. 目标与非目标

**目标**
- G1：把 `nodes_json` 解析为真正的 DAG——Kahn 分层拓扑排序，环检测、
  未知依赖检测、缺 id/重复 id 校验。
- G2：按层推进执行，层内 `asyncio.gather` 并行执行节点；每个节点执行后
  独立落库 `task_steps`（带 `node_id` / `dependencies_json` / `order_index`）。
- G3：新增 `WorkflowRun` 运行记录表，追踪一次工作流运行的生命周期
  （running → completed / failed），并保存运行时节点快照。
- G4：响应契约向后兼容——`run` 接口仍返回 task_id / workflow_id / title /
  status / message，入参 schema 不变。

**非目标**
- N1：不做 DAG 画布前端（留给 Phase 3），前端提交结构不变。
- N2：不改 orchestrator.py；DAG 引擎独立于 AgentOrchestrator，仅复用其
  模块级函数（`save_task_step` / `call_agent_model` / `update_task_status`）。
- N3：阶段一不做节点级重试与断点续跑；不做跨进程分布式编排。

## 3. 用户故事

- US1：用户运行「全栈功能开发流水线」模板后，可在任务详情里看到每个
  节点对应的 step（含节点名、依赖、执行顺序），并行分支同时推进。
- US2：某个节点失败后，后续依赖该节点的层不再执行，任务置 FAILED，
  已完成层的 step 保留可追溯；工作流运行记录显示 failed。
- US3：管理员创建带环或引用不存在节点的模板数据时，运行接口返回 422
  并给出中文错误原因。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 新建 `app/services/dag_engine.py`：`parse_nodes(nodes_json)` 容错解析（空/空串返回空列表，非法 JSON/非数组抛 ValueError） | P0 |
| FR2 | `topological_sort(nodes)`：Kahn 分层排序；节点 id 取 `node["id"]`，依赖取 `dependencies`（兼容 `depends_on` 别名）；未知依赖、环、缺 id、重复 id 抛 ValueError（中文消息）；返回按层分组的节点列表 | P0 |
| FR3 | `execute_dag(layers)`：按层推进，层内 `asyncio.gather` 并行；每节点独立会话执行并通过 orchestrator 的 `save_task_step` 落库，步骤写入 `node_id` / `dependencies_json` / `order_index`（全局递增序号，层内按节点顺序分配） | P0 |
| FR4 | 节点执行体可注入（`NodeExecutor` 类型）；默认实现按 `agent_role` 匹配工作区 Agent（role 或 name），调用 `call_agent_model` 执行节点 prompt | P0 |
| FR5 | 失败语义：某节点失败 → 该节点 step 记 failed 输出 → 中止所有后续层（同层已启动节点执行完毕）→ 任务置 FAILED、WorkflowRun 置 failed；已完成层的 step 保留 | P0 |
| FR6 | `TaskStep` 加三列：`node_id`（String(64)，索引）、`dependencies_json`（Text，前置 node_id 列表 JSON）、`order_index`（Integer） | P0 |
| FR7 | 新增 `WorkflowRun` 模型与 `workflow_runs` 表：`template_id`（FK，索引）、`task_id`（FK，索引）、`status`（默认 running，索引）、`snapshot_nodes_json`（运行时节点快照）、时间戳 | P0 |
| FR8 | `run_workflow_template` 重写：解析 → 变量渲染 → 拓扑分层 → 建 Task（PENDING）+ WorkflowRun（running）→ `asyncio.create_task` 进程内后台执行；环检测失败/缺 id/空节点返回 422；响应契约不变 | P0 |
| FR9 | Alembic 迁移一次完成：建 `workflow_runs` 表 + `task_steps` 加三列；SQLite 用 `batch_alter_table` 保证双兼容；downgrade 可完整回滚 | P0 |

## 5. 非功能需求（NFR）

- **兼容**：`run` 接口入参/响应 schema 不变；`WorkflowNode` schema 不加字段；
  orchestrator、tasks 端点、前端零改动。
- **并发安全**：SQLite 不支持并发写，每个节点执行使用独立会话
  （session_factory），step 落库串行化在各自会话内完成；层间天然串行屏障。
- **租约兼容**：引擎把 PENDING 任务认领为 RUNNING 时写入
  `execution_token` / `execution_token_expires_at`（30 分钟租约），与现有
  worker 租约语义一致；终态清空。
- **执行模式**：阶段一为进程内后台 asyncio 任务（inline 路径）。当前工作流
  运行路径本就不经过 task_queue 入队，故保持不入队；未来切 queue 模式时
  可在 `run_workflow_dag` 入口改为 `TaskService.enqueue`，语义不变。
- **可观测**：运行记录（WorkflowRun）+ 节点级 step + 审计日志
  （dag_layers / dag_nodes / workflow_run_id）三层可追溯。

## 6. 验收标准（AC）

- AC1：`topological_sort` 对 A→B、A→C、B/C→D 输出三层：[A] / [B,C] / [D]。
- AC2：A→B→A 环、未知依赖 id、缺 id 分别抛 ValueError（中文消息）。
- AC3：节点 b 失败后，下游 d 不执行（无 step 记录）；同层 c 正常完成；
  b 的 step 状态为 failed 且含错误输出；任务最终 FAILED、WorkflowRun failed。
- AC4：两个无依赖节点并行分支都被执行，step 落库 node_id / order_index /
  dependencies_json 正确。
- AC5：迁移 upgrade 后 `workflow_runs` 表存在、`task_steps` 三列存在；
  autogenerate 无差异（test_alembic_migrations.py 既有机制覆盖）。
- AC6：`pytest backend/tests` 全绿。

## 7. 数据与配置模型

- `workflow_runs`（新表）：`id` PK、`template_id` FK→workflow_templates.id
  （CASCADE，索引）、`task_id` FK→tasks.id（CASCADE，索引）、`status`
  String(32) 默认 "running"（索引）、`snapshot_nodes_json` Text、
  `created_at` / `updated_at`。
- `task_steps`（加三列）：`node_id` String(64) 可空（索引）、
  `dependencies_json` Text 可空、`order_index` Integer 可空。
- 迁移：`b7c9d1e3f5a7_add_workflow_runs_and_task_step_dag_fields`，
  down_revision=`a1b2c3d4e5f6`。

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | TaskStep 三列 + WorkflowRun 模型 + Alembic 迁移 | ✅ 完成 |
| M2 | dag_engine.py（parse / topological_sort / execute_dag / run_workflow_dag） | ✅ 完成 |
| M3 | run_workflow_template 重写（DAG 校验 + 后台调度 + 契约兼容） | ✅ 完成 |
| M4 | test_dag_workflow.py 单测 + 全量回归 | ✅ 完成 |
| M5 | DAG 画布前端（Phase 3） | ⏳ 未开始 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-186 | 已完成 | 待填 | LI | Requirement | 后端、数据库 | 工作流执行由「全部节点拼成一段 prompt」重写为真正的 DAG 引擎：拓扑分层 + 层内并行执行 + 节点级步骤落库与运行记录 | -（DAG 画布留 Phase 3） | services/dag_engine.py（Kahn 分层+asyncio.gather）+ workflows.py run_workflow_template 重写 + WorkflowRun 表 + task_steps 加 node_id/dependencies_json/order_index | 是（workflow_runs 新表；task_steps 新增三列） | 是（工作流执行语义由拼 prompt 改为 DAG 编排） | pytest 全绿 | PRD: docs/prd/PRD-DAG工作流引擎.md |

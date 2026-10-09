# PRD ｜ 工作流运行记录与画布可视化

> 类型：新需求（Requirement）｜状态：施工中｜关联：REQ-B2 / REQ-B1（20260907 报告 §八；20260925 报告 §4.1 复核仍为 0% 落地）
> 目标：让「工作流跑过什么、跑成什么样、节点之间是什么拓扑」可见、可查、可编辑。当前数据面已就绪但**只写不读**，渲染面为零。

---

## 1. 目标与背景

WorkflowRun 表（C-186 引入）与 TaskStep 的 node_id / dependencies_json / order_index（DAG 引擎预留）落地后，运行事实一直在写库，但：

- **没有任何读 API**：4 个工作流端点里没有一条返回运行记录（REQ-B2）。
- **前端从不渲染依赖**：frontend/src/app/workflows/page.tsx 按数组顺序用 ChevronRight 线性串联，dependencies 在该页恒为空数组（L63 / L70 / L607）；既没有依赖编辑，也没有删除节点按钮；创建表单的变量数组是 const [newVariables]，连 setter 都没有（L73）。
- 结果：DAG 引擎的能力（分层并行、环检测、人工审批分支）对用户完全不可见，DAG 与线性流水线在界面上无从区分。

本需求补齐**只读的运行记录**与**可编辑的拓扑呈现**，不改变任何执行语义。

## 2. 用户故事

- **US1**：作为工作区成员，我想看到某模板最近若干次运行的状态（运行中 / 成功 / 失败）、时间与关联任务，以判断这条流水线是否稳定。
- **US2**：作为工作区成员，我想点进单次运行，看到该次运行的节点快照与各节点落库状态，以定位卡在哪一步。
- **US3**：作为工作区管理员，我想在模板详情里看到**分层 DAG 画布**（节点按拓扑层排布、依赖以连线表示、人工审批节点样式可区分），而不是一条线性胶囊。
- **US4**：作为工作区管理员，我想在创建模板时**增删变量**、为节点**选择前置依赖**、**删除节点**。
- **US5**：作为工作区成员，我在任务回放里看到的步骤要能对上工作流节点（node_id）。

## 3. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|---|---|---|
| **FR1** | GET /api/v1/workspaces/{wid}/workflows/{tid}/runs?limit=&offset=：返回该模板运行记录分页列表（默认 limit=20、上限 50，按 id 倒序）。workflow_runs **无 workspace_id 列**，必须经 tasks.workspace_id 反查隔离 | P0 |
| **FR2** | GET /api/v1/workspaces/{wid}/workflows/{tid}/runs/{run_id}：返回单次运行详情，含 snapshot_nodes_json 解析后的节点快照、status、task_id、起止时间；非法 JSON 容错为空列表 | P0 |
| **FR3** | 前端新增「运行历史」入口（模板卡片 / 详情抽屉）：列表展示状态徽章、时间、节点数，可跳转 /tasks/{task_id} | P0 |
| **FR4** | 前端新增**纯 SVG 自绘 DAG 画布**：Kahn 拓扑分层 → 分层排布 → 依赖连边；human_approval 节点独立样式；无依赖时退化为单列。**不引入 reactflow / d3 等新依赖** | P0 |
| **FR5** | 创建模板表单补齐：变量**增删改**（setter）、节点 dependencies 多选（从已有节点中选）、**删除节点**按钮 | P0 |
| **FR6** | TaskStepRead 补 node_id / dependencies_json / order_index 三个**已存在列**的只读字段，并在回放帧中返回，使回放步骤与画布节点可对齐 | P1 |

## 4. 非功能需求（NFR）

- **不新增表、不新增列**：全部消费既有 workflow_runs 与 task_steps 预留字段，因此**无数据库迁移、无破坏性变更**。
- **不引入前端新依赖**：画布与分层算法自实现为 TS 纯函数，可单测。
- **兼容**：现有 4 个端点入参与响应契约不变；WorkflowRunResponse（派发响应）命名不动，新 schema 另起名。
- **隔离**：所有新端点经 require_workspace_role("viewer") 与 task 反查双重校验。

## 5. 数据模型

| 对象 | 现状 | 本需求 |
|---|---|---|
| workflow_runs | template_id / task_id / status / snapshot_nodes_json / 时间戳 | 只读消费（无 schema 变更） |
| tasks | workspace_id | 作为运行记录的隔离来源（join） |
| task_steps | 已有 node_id / dependencies_json / order_index | 只读暴露 |

## 6. 后端设计

- 端点文件：backend/app/api/v1/endpoints/workflows.py（新增两个 GET）。
- Schema：backend/app/schemas/workflow.py 新增 WorkflowRunSummary（列表项）与 WorkflowRunDetail（详情）；**不得复用 WorkflowRunResponse**（后者是派发响应，属既有命名陷阱）。
- 隔离：先按模板校验工作区角色，再以 WorkflowRun.template_id == tid 取记录并用 Task.workspace_id == wid 约束；越权 403，越界 id 404。
- 错误语义：snapshot_nodes_json 解析失败 → 空列表 + 200（快照是展示性数据，不阻断查询）。

## 7. 前端设计

- frontend/src/types/workflow.ts：补 WorkflowNode.type（后端已有、前端缺失），新增 WorkflowRunSummary / WorkflowRunDetail。
- 新增 frontend/src/components/workflows/dag-canvas.tsx：layoutDag(nodes)（Kahn 分层；未知依赖与环兜底进末层）与 SVG 渲染。
- frontend/src/app/workflows/page.tsx：运行历史抽屉 + 画布替换线性胶囊 + 创建表单补齐（变量 setter、依赖多选、删除节点）。
- 单测：frontend/tests/dag-layout.test.mjs（分层正确性、环兜底、单节点、多根多汇）。

## 8. 安全

- 新端点必须同时满足「工作区角色校验」与「资源归属校验」，防止以 run_id 越权读取他工作区运行记录（对齐 C-196 隔离先例）。
- 快照与步骤输出为展示数据，不额外回传凭证类字段。

## 9. 验收标准（AC）

- **AC1**：某模板产生 3 次运行后，GET .../runs 按倒序返回 3 条，含 status / task_id / 时间戳。
- **AC2**：limit 缺省 20、超过 50 报 422；offset 生效。
- **AC3**：非本工作区用户访问 → 403；不存在 run_id → 404。
- **AC4**：详情返回解析后的节点快照；快照为非法 JSON 时返回空数组且仍 200。
- **AC5**：画布对 A→B、A→C、B&C→D 的模板呈 3 层；无依赖模板为单列；人工审批节点样式可区分。
- **AC6**：创建表单可增删变量、可选依赖、可删节点，提交后与表单一致。
- **AC7**：回放帧含 node_id（FR6）且与画布节点 id 对应。
- **AC8**：后端 pytest 全量通过 + flake8 严格参数 0 违规；前端 npm run typecheck / lint / test / build 全绿。

## 10. 里程碑

| 阶段 | 内容 | 依赖 |
|---|---|---|
| M1 | FR1 / FR2 / FR6（后端 + 测试） | 无 |
| M2 | FR3 运行历史 UI | M1 |
| M3 | FR4 画布 + FR5 表单补齐（同页合并交付） | M2 |

## 11. 风险与应对

- **风险**：workflow_runs 无 workspace_id，隔离依赖 join tasks；task 被删则出现孤儿运行记录。**应对**：查询用 inner join；P0-5 已落地的 recover_orphan_workflow_runs 会收敛父任务终态但 run 仍 running 的孤儿。
- **风险**：存量历史运行的 snapshot_nodes_json 可能为空或字段不全。**应对**：详情接口容错为空列表，画布对空节点渲染空态提示而非报错。
- **风险**：自绘 SVG 在宽模板上溢出。**应对**：容器横向滚动 + 层内换行；单测覆盖 10 节点以上用例。

## 12. 系统关系

workflow_templates（模板定义）→ POST /run（DAG 引擎 run_workflow_dag 分层执行）→ workflow_runs（运行事实）→ 本需求新增读 API → 前端运行历史与画布；task_steps.node_id 是回放与画布对齐的公共键。

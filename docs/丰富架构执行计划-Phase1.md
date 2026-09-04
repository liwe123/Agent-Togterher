# Agent Console 丰富架构 · Phase 1 执行计划

> 依据 `docs/Agent任务守则.md` 制定，粒度对齐「最便宜模型可低出错率落实」。
> 三个子项均为 **Requirement**，须各写 PRD 并三处同步。
> 执行顺序：A → B → C（C 依赖 A 的 httpx 引入，B 独立可并行）。

---

## 前置准备（一次性）

1. 环境确认（Windows + bash）：
   - Python venv：`~/.workbuddy/binaries/python/envs/default`（已装 openpyxl/markdown，用于守则脚本）
   - 后端测试依赖：`pip install -r backend/requirements-dev.txt`
   - 分支：确认 `git remote -v` 指向 `https://github.com/liwe123/Agent-Togterher.git`，当前在 `main`，`git status` 干净
2. 每个 Requirement 开工前先写 PRD，参照 `docs/prd/PRD-单任务上下文连续性与执行过程可视化.md` 结构（目标 / 用户故事 / FR / AC，补数据模型/后端/前端/安全/里程碑）。

---

## 子项 A · 插件 Webhook 工具执行器 + 出站通知

**类型**：Requirement（写 PRD-插件Webhook执行器与出站通知.md）

### 改动锚点
| 文件 | 改动 |
|---|---|
| `backend/app/schemas/plugin.py` | `PluginToolDefinition`(L13-18) 增 `headers: dict`、`secret: str`；`PluginManifest`(L21-29) 增 `secret` |
| `backend/app/services/webhook.py`（新建） | httpx 出站 + HMAC-SHA256 签名 + `asyncio.wait_for` 超时 + 重试 |
| `backend/app/services/tools.py` | `load_active_plugin_tools`(L286-297) 把 headers 带进 record；`register_plugin_tool_executor`(L174-176) 注册真实执行器替换 `_default_plugin_tool_executor`(L191-197) |
| `backend/app/core/orchestrator.py` | `update_task_status`(L687-707) commit+broadcast 后挂 `await _notify_task_terminal(...)` |
| `backend/requirements.txt` | 加 `httpx>=0.28,<1.0` |

### 步骤
1. PRD 落 `docs/prd/`，在 `docs/PRD.md` 索引登记。
2. schema 加字段 → `alembic` 无需迁移（manifest_json 为 Text，字段在 JSON 内）。
3. 新建 `webhook.py`：函数 `async def call_webhook(url, method, headers, body, secret, timeout=10)`；HMAC 头 `X-Webhook-Signature = sha256(secret, body)`；失败记日志不抛。
4. `tools.py` 注册 executor：`executor(record=..., arguments=..., workspace_id=..., session=...)` 从 record 读 `url/method/headers/secret`，调用 `webhook.call_webhook`，返回响应文本。
5. 启动接线：`backend/app/main.py` 与 `backend/app/worker.py` 启动处调用注册（仅一次）。
6. 出站通知：`orchestrator.update_task_status` 末尾 `if status in (COMPLETED, FAILED): await self._notify_task_terminal(...)`；通知目标来自 workspace 插件配置，无配置则跳过。

### 测试与验收
- 单测：`backend/tests/test_webhook.py`（签名正确、超时、非 2xx 不抛）。
- 冒烟：起后端 + 注册一个 mock webhook（httpbin 或本地），跑一个任务到终态，确认收到回调。
- `pytest backend/tests` 全绿。

---

## 子项 B · HITL 人工审批节点

**类型**：Requirement（写 PRD-人工审批节点.md）

### 改动锚点
| 文件 | 改动 |
|---|---|
| `backend/app/api/v1/endpoints/tasks.py` | 新增 `POST /{task_id}/approve`、`POST /{task_id}/reject`（L227 cancel 之后） |
| `backend/app/core/orchestrator.py` | 多 agent 流程 `_run_multi_agent_task` 在 review(L457) 完成、final(L513) 之前插入 `_request_approval`：置 `WAITING_APPROVAL` + `save_task_step(status="waiting", step_name="human_approval")` + `asyncio.Event` 等待 |
| `backend/app/schemas/workflow.py` | `WorkflowNode`(L6-11) 增 `type: str = "agent"`（枚举 `agent|human_approval`）；`workflows.py` L266-282 渲染循环按 type 分支，审批节点跳过 prompt |
| `backend/app/models/task.py` | 复用 `TaskStep`(L72-94)，`step_name="human_approval"`、status 用 `waiting/approved/rejected`，无需新列 |
| `frontend/src/components/tasks/task-detail-page.tsx` | `TaskSteps`(L379-453) 对 `status==="waiting"` 或 `task.status==="waiting_approval"` 渲染「通过/驳回」按钮；`lib/task-format.ts` 补 `human_approval` 标签 |

### 步骤
1. PRD。
2. 后端：加 approve/reject 路由 → 校验任务状态为 `WAITING_APPROVAL` → 设置审批结果 → 触发 orchestrator 继续（用进程内 `asyncio.Event` 注册表；Worker 跨进程时用 Redis 键通知，阶段先用进程内）。
3. orchestrator 插入审批挂起；`save_task_step` 记录 `approved/rejected`。
4. workflow schema + 渲染分支。
5. 前端 `TaskSteps` 加按钮，调 approve/reject API；按钮仅对 owner/admin 显示（复用 `permissions.py`）。
6. WebSocket 复用 `task.status_changed`（`events.py` 无需新增事件）。

### 测试与验收
- 单测：审批挂起→通过→继续执行；驳回→终态并落 step；非审批状态调 approve 返回 409。
- 冒烟：跑一个含审批节点的 workflow，前端点通过，观察步骤推进。
- `pytest backend/tests` 全绿。

---

## 子项 C · DAG 工作流引擎（替换「压成一段 prompt」）

**类型**：Requirement（写 PRD-DAG工作流引擎.md）｜依赖 A（httpx 已引入，非强制）

### 改动锚点
| 文件 | 改动 |
|---|---|
| `backend/app/models/workflow.py` | 新增 `WorkflowRun` 表：`id, template_id, task_id, status, snapshot_nodes_json` |
| `backend/app/models/task.py` | `TaskStep`(L72-94) 增 `node_id: str`、`dependencies_json: Text`、`order_index: int`（Alembic 迁移） |
| `backend/app/api/v1/endpoints/workflows.py` | `run_workflow_template`(L247-319) 重写：拓扑排序 nodes → 就绪判定 → 复用 worker `claim_next`/`save_task_step` 调度，不再拼 `full_prompt` |
| `backend/app/core/orchestrator.py` | 新增 DAG 执行分支，`asyncio.gather` 并行无依赖分支 |
| `backend/alembic/versions/` | 新增迁移：workflow_runs 表 + task_steps 三列 |

### 步骤
1. PRD。
2. 迁移：`alembic revision -m "add workflow_runs and task_step dag fields"` → 编辑 upgrade/downgrade。
3. 建 `WorkflowRun` 模型 + `TaskStep` 三字段。
4. 重写 `run_workflow_template`：
   - 解析 `nodes_json` → 建 node 映射；
   - 拓扑排序（Kahn 算法，`dependencies` 为前置 node_id 列表）；
   - 按层推进：层内无依赖节点 `asyncio.gather` 并行执行；每节点执行复用 `_run_single_agent_task`/`call_agent_model` 或入 `task_queue`（阶段一用进程内 gather，保持与现有 worker 租约兼容）；
   - 每步 `save_task_step(node_id=..., order_index=...)`，写入 `WorkflowRun` 快照与状态。
5. 兼容：`run` 仍返回 `task_id`（`workflows.py` 响应契约不变），前端 `workflows/page.tsx` 提交 body 不破坏。
6. 前端可选：`workflows/page.tsx` 加节点列表展示（DAG 画布留到 Phase 3，不在本项范围）。

### 测试与验收
- 单测：拓扑排序（含环检测报错）、并行分支结果聚合、依赖不满足不执行。
- 冒烟：造一个 3 节点（A→B, A→C, B/C→D）模板，运行后核对 4 个 step 顺序与并行度。
- `pytest backend/tests` 全绿。

---

## 子 Agent 分工（守则 3）

- **开发主 Agent（本 Agent）**：定序、汇总、最终落地、写 PRD、跑守则脚本。
- **子 Agent 1**：子项 A 后端（schema/webhook/tools/orchestrator + 测试）。
- **子 Agent 2**：子项 B 后端 + 前端审批按钮（可并行）。
- **子 Agent 3**：子项 C 后端（模型/迁移/引擎 + 测试）。
- **验收子 Agent（独立）**：全部完成后只校验不修改（改动表格式/PRD 三处/测试无回归/脚本重跑对齐），结论写入《改动表》备注。

## 守则收尾清单（每项 + 总收尾）

- [ ] 改动表 `docs/Agent_Console_变更追踪.xlsx`：14 列、表头第 2 行、H 列中文、类型字面量 `Requirement`
- [ ] PRD 三处同步：`docs/prd/PRD-*.md` + `PRD.html` + `docs/PRD.md` 索引
- [ ] `python docs/generate_change_log.py` + `python docs/build_prd_html.py` 重跑对齐
- [ ] `pytest backend/tests` 全绿；前端改动 `npm run build` + lint
- [ ] 独立验收子 Agent 通过，结论入备注
- [ ] 提交：Conventional Commits（`feat: ...`）；`git add` 仅真实改动文件，排除 `__pycache__/`、`.workbuddy/`、`*_备份.xlsx`；`git push` 至 main

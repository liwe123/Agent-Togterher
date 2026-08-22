# PRD：外部任务包元数据与状态机补齐（P2）

> 状态：已交付
> 日期：2026-08-22
> 依据：`docs/外部-Agent-桥接落地可行性计划.md` Phase 2 + P1 遗留 dispatch 异步化
> 关联：`docs/handoff-20260822-104036.md` §2.2

---

## 目标

把外部 Agent（Cursor / Codex）派发任务从"只有标题+描述的纯文本沙盒"升级为**带验收条件、路径约束、验证命令、预算的完整任务包**，并补齐状态机（`waiting_approval`）、结果校验、取消与孤儿恢复能力。对齐调研文档 MVP 硬要求，使"output.md 非空 ≠ 成功"变为可校验的闭环。

## 用户故事

1. 作为调度者，我派发任务时能附带验收条件与测试命令，任务完成与否由客观标准判定，而非仅凭 Agent 自述。
2. 作为调度者，我能给任务设时长预算，超限自动失败，防止外部 Agent 失控消耗。
3. 作为调度者，我能随时取消执行中的外部任务，宿主进程被终止、时间线记录取消。
4. 作为使用者，我在前端能看到"等待审批"状态的任务徽章，理解人肉闭环（CursorBridge）正在等我。
5. 作为运维者，backend 重启后，遗留的外部执行步骤会被自动标记失败，不产生僵尸 running。

## 功能需求 FR

| # | 需求 |
|---|---|
| FR1 | dispatch API 与 `BridgeTask` 支持元数据：`acceptance_criteria`（验收条件列表）、`allowed_paths`（允许读写路径）、`test_command`（验证命令）、`budget_seconds`（最大时长）、`budget_turns`（最大轮次）、`dependencies`（依赖任务 id 列表），全部可选 |
| FR2 | `prepare_task` 把元数据写入 `task.json`；PROMPT.md 结构化为「验收条件 / 路径约束 / 验证命令」段落；无元数据时保持旧格式兼容 |
| FR3 | 有 `test_command` 的任务在 bridge 成功返回后于任务目录内执行该命令（超时 300s），输出写入 `test_output.txt` 并追加到 TaskStep 输出；命令不过则整体判 failed |
| FR4 | 无 `test_command` 但有验收条件时，PROMPT.md 明确要求 Agent 逐条回应验收条件 |
| FR5 | `budget_seconds` 生效为 bridge 执行硬超时上限（与各自默认超时取小）；`budget_turns` 本轮随包透传记录（执行器轮次控制留给 P4/P5） |
| FR6 | 新增 `POST /api/v1/tasks/{id}/cancel`：非终态任务置 `cancelled`；对外部执行同时（a）触发进程内 cancel event，（b）写 `CANCELLED` 标记文件到 bridge 任务目录，（c）将运行中 integration step 置 failed |
| FR7 | CodexBridge 收到 cancel event 时终止整个 codex 进程树并返回取消结果；CursorBridge 轮询循环检测 cancel event 或 CANCELLED 标记即退出 |
| FR8 | `TaskStatus` 增加 `WAITING_APPROVAL = "waiting_approval"`（VARCHAR 存储，ORM 层变更）；dispatch endpoint 异步化：立即返回 `status="accepted"` 受理响应，实际执行转后台任务 |
| FR9 | 未注册 bridge 的 provider 在 dispatch 时返回明确 422（P1.5 收尾） |
| FR10 | backend 启动时执行孤儿恢复：running 的 integration_dispatch 步骤超过租约（默认 10 分钟）标记 failed，关联 running 任务标记 failed |

## 数据模型

- 无新表。`tasks.status` 枚举加值 `waiting_approval`；因 VARCHAR 长度由最长枚举值决定（9→16 字符），新增 Alembic 迁移 `f788539de554`（batch_alter_table 修改列类型，SQLite/PG 双兼容）。
- 任务包元数据存于 bridge 目录契约文件（task.json / PROMPT.md），不入库。

## 前端

- `types/chat.ts`：TaskStatus 联合类型加 `"waiting_approval"`。
- `task-status-badge.tsx` / `message-bubble.tsx`：补「等待审批」标签与 violet 配色。
- `lib/task-utils.ts`：`waiting_approval` 为非终态，rank 同 running。

## 后端

| 文件 | 改动 |
|---|---|
| `app/services/bridge.py` | BridgeTask 加 7 个可选字段；`_render_prompt` 结构化 PROMPT.md；prepare_task 写 task.json 元数据段 |
| `app/models/enums.py` | TaskStatus.WAITING_APPROVAL |
| `app/services/integration_service.py` | DispatchPackage 数据类；cancel event 注册表；`_run_test_command` 结果校验；budget 经 BridgeTask 下传 bridge；`cancel_external_execution`；`recover_orphan_integration_steps`；未支持 provider ValueError |
| `app/schemas/integration.py` | dispatch 请求体扩展元数据字段；响应加 `status="accepted"` |
| `app/api/v1/endpoints/integrations.py` | dispatch 异步化（schedule_node_dispatch 后台执行 + build_bridge 预校验 422） |
| `app/core/message_hub.py` | `_run_node_dispatch` 支持 package；新增 `schedule_node_dispatch`（持强引用 + done callback） |
| `app/services/codex_bridge.py` | asyncio.wait 竞争 communicate/cancel/timeout；budget 取小超时；取消杀进程树 |
| `app/services/cursor_bridge.py` | 轮询检测取消（event + CANCELLED 文件）；budget 上限 |
| `app/api/v1/endpoints/tasks.py` | 新增 POST /{task_id}/cancel（终态 409、审计埋点、WebSocket task.status_changed 广播） |
| `app/main.py` | lifespan 启动时调用孤儿恢复 |

## 安全

- 取消与元数据只能经 dispatch/cancel API 写入；bridge 目录中的 PROMPT.md 约束段对 Agent 是提示而非硬边界（worktree 硬边界留给 P5）。
- test_command 在 backend 宿主机执行——属受信配置面（dispatch API 才可写），与提示注入隔离。

## 验收标准 AC

1. AC1 带 `test_command` 的派发：命令通过 → completed；故意给必失败命令 → failed 且 TaskStep 可见测试输出（单测覆盖 service 层语义）。
2. AC2 无元数据 prepare_task 产出的 task.json / PROMPT.md 与旧行为逐字节一致（回归单测）。
3. AC3 pending 任务调用 cancel → cancelled；重复 cancel → 409；有 running integration step 时 step 置 failed 且 CANCELLED 标记落盘（单测覆盖）。
4. AC4 孤儿恢复：超租约 integration step → failed + 关联任务 failed；新步骤与非 integration 步骤不受影响（单测覆盖）。
5. AC5 dispatch endpoint 立即返回 accepted 且后台调度收到完整 package；未注册 provider 返回 422（单测覆盖）。
6. AC6 全量后端 pytest 通过（128 passed）、前端 build/test/lint 通过（28 passed）。
7. AC7 Alembic upgrade head → autogenerate 无 diff；downgrade base 干净回滚。

## 里程碑

- M1 元数据 + 状态机 + dispatch 异步化（本批）
- M2 结果校验 + 取消 + 孤儿恢复（本批）
- M3 P3 Antigravity adapter（受阻：agy 未安装）

## 风险

| 风险 | 缓解 |
|---|---|
| test_command 任意命令执行面 | 仅 dispatch API 可写，等同既有信任边界；P5 worktree 后收敛 |
| budget_turns 无法通用执行 | 本轮透传记录，执行器级轮次控制放 P4 host-agent |
| waiting_approval 尚无写入方（CursorBridge 人肉审批流未接） | 枚举与 UI 先行，P3/P4 接线 |

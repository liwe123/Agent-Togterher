# 外部 Agent 桥接落地可行性计划

> 制定日期：2026-08-21（GMT+8）
> 依据：`docs/Cursor、OpenAI-Codex-与-Google-Antigravity-的-Agent-桥接调研报告.md`、`docs/自建多-Agent-协作项目：可行性评估与-MVP-路线.md`（两份 Manus 调研）+ 本项目代码实证评审
> 性质：执行计划。两份调研文档的结论已评审为"可采纳"，本文档负责落地，并修正其盲区。

---

## 0. 基线：项目现状 vs 调研文档设想

项目实际已走到调研文档二"阶段 1 之后"，部分领先：

| 能力 | 文档设想 | 项目现状 |
|---|---|---|
| 任务状态机 / 持久化队列 / 独立 Worker / 租约 | MVP 必须 | ✅ 已有（TaskService + task_queue_items + worker.py） |
| 审计 / 回放 / 成本 / 配额 | 超出 MVP | ✅ 已有（Phase 4 交付物） |
| 内部 LLM Agent 编排（LiteLLM） | 文档未涉及 | ✅ 已有，混合编队是差异化 |
| Codex adapter | `codex exec` CLI | ⚠️ 已实现，但**Docker 部署下必挂**（容器内无 codex 二进制） |
| Cursor adapter | ACP（stdio + JSON-RPC） | ⚠️ 实际为文件契约 + 宿主客户端轮询（人肉闭环） |
| Antigravity adapter | `agy -p` headless | ❌ seed 了节点但无 bridge（dispatch 直接 ValueError） |
| 任务包元数据（验收/路径/测试命令/预算） | MVP 硬要求 | ❌ prepare_task 只有 title + description |
| 任务状态 WaitingApproval | MVP 硬要求 | ❌ 枚举只有 pending/running/completed/failed/cancelled |
| dispatch 异步化 / 取消 / 孤儿恢复 | MVP 硬要求 | ⚠️ dispatch 同步阻塞（最长 600s 占住 HTTP 请求），取消不覆盖外部任务 |
| 价值度量（对比人工基线） | 阶段 2 止损线 | ❌ 无 |

**核心约束（两份文档的共同盲区）**：部署拓扑。后端跑 Docker 容器、Cursor/codex/Antigravity 跑宿主机，导致：文档力荐的 Cursor ACP（stdio）不可行；CodexBridge 在默认启动方式（`start.bat` → `docker compose up`）下 FileNotFoundError。**先定拓扑，再谈 adapter**，是本计划的第一决策。

---

## Phase 0：部署拓扑定案（先行决策，半天）

| 方案 | 做法 | 适用 | 代价 |
|---|---|---|---|
| **A. 混合本机（推荐，立即）** | db/redis 留容器，backend 宿主机裸跑 `uvicorn`；Windows venv + start-local.bat | 单人/单机（当前场景） | Docker 编排退化为基础设施；CI 不受影响 |
| B. 容器后端 + 宿主 daemon | 后端留容器，宿主机跑 host-agent 执行器（Phase 4） | 多机/24×7/团队化 | 需新增 daemon 与回连协议 |

**决策规则**：现在选 A，出现多机或 24×7 需求再迁 B。A→B 平滑：目录契约（PROMPT.md/task.json/output.md/events.jsonl）两种拓扑通用，`cursor_client.py` 已验证宿主机侧模式可行。

Phase 0 交付：
- `start-local.bat`：`docker compose up -d db redis` + 宿主 venv 启动 backend + frontend
- `docker-compose.yml` 的 `user: "0:0"` root hack 保留在 Docker profile 中（方案 B 用），但不再是默认路径
- 验收：本机 `codex --version` 可被 backend 子进程找到；dispatch 到 Codex 节点端到端成功一次

---

## Phase 1：热修与基线加固（2–3 天）

| # | 事项 | 现状 → 目标 |
|---|---|---|
| 1.1 | `--skip-git-repo-check` 移出默认配置 | `codex_bridge.py:41` 写死 → `BRIDGE_CODEX_SKIP_GIT_CHECK` 环境变量可配；默认值暂留 True 向后兼容（bridge 任务目录非 git repo），Phase 5 worktree 落地后切 False |
| 1.2 | Codex 超时可配置 | 硬编码 300s → `BRIDGE_CODEX_TIMEOUT_SECONDS` |
| 1.3 | Windows 进程树清理 | `process.kill()` 只杀直接子进程 → `taskkill /T /F` 或 job object，防 codex 子进程残留 |
| 1.4 | dispatch 异步化 | endpoint 同步 `await dispatch_task_to_node`（阻塞至 600s）→ 入 `task_queue_items` 或 background task，立即返回 step id，进度走 WebSocket（复用现有 `task.step_changed`） |
| 1.5 | provider 一致性 | seed 有 cursor/codex/trae/antigravity 四节点但 `_BRIDGE_FACTORIES` 只注册两个 → 未注册 provider 返回明确 4xx + 前端节点标记 unsupported |

验收：dispatch 后 HTTP 立即返回；Codex 任务超时后无残留进程；请求未注册 bridge 的节点得到可读错误。

---

## Phase 2：任务包元数据与状态机补齐（1 周）

对齐调研文档二 MVP 表格的硬要求：

1. **任务包扩展**（`BridgeTask` + `prepare_task` + dispatch API 请求体）：
   - `acceptance_criteria`：验收条件（非空才允许标记 completed）
   - `allowed_paths`：允许读写路径（写入 PROMPT.md 约束段，Phase 5 升级为 worktree 硬边界）
   - `test_command`：验证命令
   - `budget`：最大时长/轮次，超限自动 Blocked→Failed
   - `dependencies`：依赖任务 id 列表
2. **状态机**：`TaskStatus` 增加 `WAITING_APPROVAL`（CursorBridge 人肉闭环的本质就是等待审批）。枚举为 `native_enum=False` + `create_constraint=False` 的 VARCHAR 存储，**加值无需 Alembic 迁移**，仅 ORM 层变更。
3. **结果校验**：output.md 非空 ≠ 成功。有 `test_command` 则执行并把输出写入 TaskStep；无则要求产出包含对 `acceptance_criteria` 的逐条回应（提示词约束）。
4. **取消**：`POST /tasks/{id}/cancel` 覆盖外部任务——杀宿主进程/标记任务目录 `CANCELLED`，CursorBridge 轮询循环检测到即退出。
5. **孤儿恢复**：backend 重启时扫描 `running` 状态的 integration step，超过租约期未心跳的标记 failed（复用 `test_task_recovery.py` 的模式）。

验收：一个带验收条件 + 测试命令的 Codex 任务，失败路径（test_command 不过）与成功路径都能在任务详情页完整回放。

---

## Phase 3：Antigravity adapter（1 周，可与 Phase 2 并行）

`agy -p` headless 与 `codex exec` 同构（非交互、stdout 结果、stderr 诊断、JSON 输出），**直接照抄 CodexBridge 模式**，且不受容器拓扑限制（宿主机跑 CLI）：

1. 前置实测（文档说法未实证）：`agy --help` 参数、认证缓存行为（非交互环境缺缓存认证会失败——文档明确提示，须当作明确状态处理）、JSON/NDJSON 输出 schema
2. `AntigravityBridge(BaseBridge)`：解析 stdout/stderr、exit code、超时/取消；认证失败映射为独立错误码而非笼统 failed
3. 注册 `_BRIDGE_FACTORIES["antigravity"]`
4. Trae：有 CLI 则同模式，无则维持 unsupported 标记（不硬做）

验收：Cursor（人肉）/ Codex / Antigravity 三节点各完成一个真实小任务，出现在同一条任务时间线上，事件流与审计一致。

---

## Phase 4：宿主机执行 daemon——host-agent（1–2 周，方案 B 落地）

把 `bridge/cursor_client.py` 泛化为通用宿主执行器，实现"后端回容器"的长期形态：

1. `host_agent.py`：按 provider 分发执行器（cursor → 拉起 IDE + 等 output.md；codex → `codex exec` 子进程；antigravity → `agy -p`）
2. 领任务：保留目录轮询（简单可靠），预留 WS 拉取升级位
3. 凭证：全部用宿主机已登录会话，后端零接触 token——与调研文档"凭证隔离/禁透传"对齐
4. 回写：output.md/events.jsonl + 心跳上报 `current_task_count`（现有 API 即够）
5. 撤掉 compose 的 root hack；后端容器化回归标准姿势

验收：后端在容器内、三个外部节点全部经 host-agent 完成任务；后端重启后 host-agent 状态恢复无重复执行。

---

## Phase 5：Git worktree + 审查闭环（2 周，改码任务升级）

对齐调研文档"一 Agent 一 worktree"的主力方案，把任务目录从纯文本沙盒升级为代码隔离：

1. 任务可选关联 git 仓库：`git worktree add <bridge_root>/task-<id> -b agent/<task_id>-<slug>`
2. Agent 只改自己的 worktree/分支；产出 diff + test_command 结果回写 TaskStep
3. `ReviewReady` 状态 + 前端合并入口；**合并权只属于人**（受保护分支）
4. file reservation/租约仅作提示，不替代 Git 边界（调研文档模式 D 的明确教训）
5. 完成后 `git worktree remove` 清理，不留管理残迹

验收：两个并行改码任务零冲突合并；一个任务故意制造冲突时被门禁拦截而非自动合并。

---

## Phase 6：价值度量与止损（持续）

调研文档二的止损线必须落实，避免"工程复杂度误认为产品价值"：

1. 度量维度（扩展 model_calls 模式到外部任务）：任务时长、人工干预次数（重试/取消/接管）、一次通过率、每任务成本
2. 基线实验：10–20 个低风险真实维护任务，对比"人工单 Agent"与"控制面调度"
3. **止损规则**：交付周期、失败率、干预次数、CI 一次通过率、成本五项中，至少两项可复现改善才继续扩大功能；否则冻结功能面

---

## 风险清单与停止条件

| 风险 | 缓解 |
|---|---|
| ACP 陷阱：容器内做 stdio ACP 会阻塞且拉不起宿主进程 | **本计划不引入 ACP**；若未来要 ACP，放在 host-agent 内（宿主机侧）实现 |
| 第三方 bridge（codex-bridge 等 MCP 包装器）供应链风险 | 不引入；项目已有更可控的 exec 直连，覆盖同等能力 |
| 提示注入：外部网页/工单内容篡改任务包 | 外部内容视为数据；任务包元数据（验收/路径/预算）只有 dispatch API 可写 |
| 凭证泄露 | 沿用"宿主机已登录会话"模式，后端不存不传外部 Agent token |
| 成本失控 | budget 字段 + 超限自动 Blocked；单任务超时硬上限 |
| Windows 特有：进程树残留、路径空格/中文 | Phase 1.3 taskkill /T；路径统一 Path 处理 |

**全局停止条件**（任一触发即回退到更低权限模式）：绕过 git 信任检查进入默认配置、生产 token 入仓/入配置文件、Agent 获得自动合并权、无人审批的破坏性操作、为"集成"关闭 sandbox 或开全网。

---

## 里程碑总表

| 阶段 | 内容 | 工期 | 依赖 | 核心验收 |
|---|---|---|---|---|
| P0 | 拓扑定案（方案 A） | 0.5 天 | — | Codex 端到端跑通一次 |
| P1 | 热修 + 基线加固 | 2–3 天 | P0 | dispatch 异步、超时可配、无进程残留 |
| P2 | 任务包元数据 + 状态机 | 1 周 | P1 | 带验收条件的任务失败/成功路径可回放 |
| P3 | Antigravity adapter | 1 周 | P0（与 P2 并行） | 三节点同一时间线 |
| P4 | host-agent daemon | 1–2 周 | P1–P3 | 后端回容器，三节点仍全通 |
| P5 | worktree + 审查闭环 | 2 周 | P2/P4 | 并行改码零冲突，合并权在人 |
| P6 | 价值度量 | 持续 | P2 | 五指标基线报告，决定扩大或止损 |

总节奏：P0–P3 约 2.5 周完成"三外部节点可靠调度"；P4–P5 约 1 个月完成"可合并的改码闭环"；P6 用真实数据决定项目走向。

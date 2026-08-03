# PRD：为 Agent 加上"手"（工具调用 / Function Calling）

> 类型：新需求（Requirement） ｜ 状态：已实施 ｜ 登记：变更追踪表 C-023

---

## 1. 背景与问题

Agent Console 当前所有 Agent 都是**纯 LLM 调用**：`litellm.chat_completion` 只传 `model/messages/temperature/api_key`，响应只解析 `content`，**没有任何工具/函数调用能力**。用户指出这是硬伤——「否则这只是个普通的 LLM」。

缺少"手"导致的业务问题：
1. Agent 只能"想"不能"做"——无法查数据、算数、获取系统实时状态，回答依赖模型训练知识，易过时/臆测。
2. 无法触达系统内部真实数据（历史任务、Agent 状态、模型配置），Agent 是个"信息孤岛"。
3. 面试/简历竞争力弱：2026 年 AI Agent 开发岗普遍要求 function calling / 工具调用能力。

## 2. 目标与非目标

**目标**
- G1：Agent 具备经典 function-calling 循环——模型可请求调用工具 → 系统执行 → 结果回填 → 模型继续。
- G2：内置至少 3 个安全、真实可用的工具（计算、查历史任务、查 Agent 状态、系统健康）。
- G3：每次工具调用全程留痕（入参/出参/结果），在任务详情时间线可见。
- G4：不破坏现有结构——不新增 WS 事件类型、不改已有表结构。

**非目标**
- N1：不接入外部第三方工具/MCP 协议（v2 考虑）。
- N2：不做 `fetch_url` 网页抓取（SSRF 风险，推迟）。
- N3：不让 Manager/QA/Final 阶段启用工具（需结构化输出，避免干扰）。

## 3. 用户故事

- US1：派发"帮我算一下 1234*56.7 并总结"时，Agent 能调用计算工具而不是靠模型硬算。
- US2：派发"查一下最近有哪些失败任务"时，Agent 能查询系统内真实任务数据。
- US3：在任务详情页看到 Agent "调用了什么工具、传了什么参数、返回了什么"。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | `chat_completion` 支持传入 `tools`（LiteLLM tools 格式），返回结果携带 `tool_calls` | P0 |
| FR2 | 新增工具注册表 `tools.py`，内置 `calculate` / `query_tasks` / `get_agents` / `get_system_status` | P0 |
| FR3 | orchestrator 增加工具循环 `_run_agent_with_tools`（调用→执行→回填→再调，最大 5 轮） | P0 |
| FR4 | 工具调用持久化为 `TaskStep`（`step_name="tool_call"`），入参/出参完整落库 | P0 |
| FR5 | 单 Agent 路径与 Worker 阶段启用工具；由配置 `agent_tools_enabled`（默认 True）控制 | P0 |
| FR6 | 工具失败不中断流程：handler 异常/未知工具返回错误字符串给模型，循环继续 | P1 |
| FR7 | 前端任务详情时间线展示「工具调用」步骤（`stepLabel` 映射） | P1 |

## 5. 非功能需求（NFR）

- **安全**：计算器用 Python `ast` 白名单，拒绝 `__import__`/`os.system`/eval；内部查询只读；绝不在工具结果中暴露 API Key。
- **可控**：工具循环最大 5 轮兜底，防止模型无限请求工具。
- **可观测**：每个工具调用的 name/arguments/result 作为 TaskStep 落库并广播 `task.step_changed`。
- **兼容**：不新增 WS 事件类型（避免破坏前端 TS 判别联合）；不新增 ModelCall 列（SQLite `create_all` 加列不生效）。
- **性能**：工具调用串行执行（SQLite 单写者），单次毫秒级。

## 6. 验收标准（AC）

- AC1：`calculate("1+2*3")` 返回 `7.0`；`calculate("__import__('os').system('echo hi')")` 被拒绝并返回错误。
- AC2：mock 模型返回 tool_calls 后，能执行工具、回填结果、再调模型，最终返回内容答案；期间生成 1 条 `tool_call` TaskStep。
- AC3：工具 handler 抛异常 / 未知工具名 → 返回错误字符串，循环继续到有答案。
- AC4：模型一直请求工具 → 5 轮后终止，不无限循环。
- AC5：`python -m pytest -q` 全部通过（含新增 test_tools.py）；前端 `npm run lint && npm test && npm run build` 通过。

## 7. 内置工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `calculate` | `{expression: string}` | ast 白名单（Add/Sub/Mult/Div/FloorDiv/Mod/Pow/UAdd/USub/常量），结果绝对值 ≤1e12 |
| `query_tasks` | `{status? enum, limit? 1..50}` | 参数化只读 `select(Task)` |
| `get_agents` | `{workspace_id? integer}` | 只读 `select(Agent)` |
| `get_system_status` | `{}` | 健康 + `is_provider_configured`（仅布尔） |
| `fetch_url` | — | v1 推迟（SSRF 风险） |

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | litellm_service 支持 tools + tool_calls 解析 | ✅ 完成 |
| M2 | tools.py 注册表 + 4 内置工具 + 安全计算 | ✅ 完成 |
| M3 | orchestrator 工具循环 + TaskStep 持久化 + 路径接线 | ✅ 完成 |
| M4 | 前端 stepLabel + 全量回归 | ✅ 完成 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-023 | 已完成 | 待填 | LI | Requirement | 前端、后端 | Agent 工具调用能力（FR1-FR7） | task-format.ts stepLabel | litellm_service/orchestrator/tools.py | 否 | 否 | pytest 54 + 前端 28/build pass | PRD-工具调用 |

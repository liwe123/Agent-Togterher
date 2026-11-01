# PRD：执行级预算与内容脱敏

> 类型：新需求（Requirement）｜状态：进行中｜目标：补齐执行侧的「预算/轮次硬控制」与「内容级敏感信息脱敏」两项安全与成本治理能力，使外部桥接任务与内部工具循环都能被明确预算约束，并保证 API Key、Token、密码、私钥等敏感值不进入持久化与实时广播。对应 20260925 基线 REQ-D4、REQ-D6。

---

## 1. 背景与问题

### 1.1 REQ-D4：budget_turns 只有透传、没有执行级控制

`IntegrationDispatchRequest.budget_turns` 当前沿 `schemas/integration.py → integration_service.py → BridgeTask` 一路透传（4 处），但执行侧没有任何消费点：

- Codex CLI 桥接使用 `process.communicate()` 等进程结束，无法在轮次超限时终止；
- 内部 orchestrator 工具循环硬编码 `max_iterations=5`，不可按任务/工作区配置；
- 预算是「声明式」的，用户以为能限制成本，实际不能。

### 1.2 REQ-D6：敏感内容可能落库与推到前端

当前只有模型错误消息做了 `_sanitize_error_message`，而 `messages.content`、`task_steps.input/output`、`model_calls.error_message`、集成桥接结果等正文在落库与 WebSocket 广播前都没有脱敏。用户粘贴 Key、Token、密码或私钥时，会原样进入数据库与前端事件流，存在泄漏风险。

---

## 2. 目标与非目标

### 2.1 目标

- **G1**：内部工具循环轮次受配置约束（默认 5，可调 1~20），超限任务明确失败并记录原因。
- **G2**：Codex CLI 桥接在 `budget_turns` 超限时终止子进程树并返回失败结果（metadata 标记超限与实际轮次）。
- **G3**：新增统一 `redact_content()`，在消息/步骤/模型调用错误、集成桥接结果落库与广播前替换敏感值。
- **G4**：脱敏可通过配置关闭（默认开启），测试可注入关闭；脱敏规则可扩展且有单测覆盖。

### 2.2 非目标

- 不做「所有出站网络请求」的统一脱敏（模型请求体属模型网关层，另行评估）。
- 不改变任务状态机、租约、队列语义。
- 不引入外部密钥扫描服务（如 gitleaks），只做内置正则与结构化规则。
- 文件系统桥（CursorBridge）无事件流，不在本批实现轮次控制（文档标注）。

---

## 3. 用户故事

- US1：作为管理员，我通过 dispatch 传入 `budget_turns=3`，外部 Codex 执行到第 4 轮时被终止，任务失败并清楚说明「超过预算轮次」，不再无限消耗。
- US2：作为开发者，我可以通过 `AGENT_MAX_TOOL_ITERATIONS` 调整内部 Agent 工具循环上限，并在任务结果中看到「未收敛/超出轮次」的明确原因。
- US3：作为用户，我误把 `sk-...` Key 粘贴进群聊后，数据库与前端实时消息中只看到 `[REDACTED:...]`，不会把 Key 泄漏到日志/落库/广播。

---

## 4. 功能需求（FR）

### FR1：内部工具循环轮次预算

- `config.Settings` 新增 `agent_max_tool_iterations: int = Field(default=5, ge=1, le=20)`，环境变量 `AGENT_MAX_TOOL_ITERATIONS`。
- orchestrator 的三条工具路径（单 Agent、多 Agent Worker、接力 hop）调用 `_run_agent_with_tools` 时传入该配置值，替换硬编码 5。
- 超限行为保持现状语义：`TaskNotRunnableError` → 任务 failed，`result` 含「tool calling did not converge after N rounds」。
- 测试通过 monkeypatch/env 注入较小上限并断言收敛失败。

### FR2：Codex 桥接轮次预算执行

- 当 `task.budget_turns is not None` 时，桥接边读 stderr JSONL 边识别轮次开始事件（`turn.started` / `turn_started`，兼容 `msg.type`）。
- 计数 > `budget_turns` 时立即 `_kill_process_tree()`，返回 `BridgeResult(success=False, message=含预算与实际轮次)`，metadata 增加 `budget_exceeded: true`、`turns`。
- 无预算时行为与现状一致；取消（cancel_event）与超时语义不变；已捕获事件写入 `events.jsonl`。
- 轮次事件识别实现为纯函数并单测；脏行不崩溃。

### FR3：内容级脱敏

- 新增 `backend/app/core/redaction.py`：
  - `redact_content(text: str | None) -> str | None`；文本为空/None 原样返回；
  - 规则表覆盖：OpenAI/Anthropic sk Key、AWS Access Key、GitHub Token、Google API Key、JWT、PEM 私钥块、`password/secret/token/api_key = 值` 赋值、`Bearer <token>`；
  - 替换为 `[REDACTED:<kind>]`，同一文本多处替换；
  - 受 `content_redaction_enabled: bool = True` 控制。
- 落库与广播入口统一套用：
  - `MessageHub` 用户消息：消息内容、任务标题/描述（提及解析仍用原文，避免路由被脱敏影响）；
  - `MessageHub._create_node_task` 节点任务；
  - `AgentOrchestrator.send_result_message` 消息内容；
  - `AgentOrchestrator.save_task_step` 的 input/output；
  - `AgentOrchestrator.save_model_call` 的 error_message；
  - `integration_service.dispatch_task_to_node` 的步骤 input/output 与任务 result（桥接返回值）。
- 脱敏后的值参与 `TaskRead`/`MessageRead`/`TaskStepEventPayload` 的广播，确保前端与审计看到的是脱敏值。

### FR4：配置与可观测

- 新增配置项：`content_redaction_enabled`（默认 true）、`agent_max_tool_iterations`（默认 5）。
- 脱敏替换计数写结构化日志（只记数量与 kind，不记原文）。
- 桥接超限失败写 `TaskStep` failed 并在任务 result 中给出明确原因。

---

## 5. 验收标准（AC）

- **AC1**：内部工具循环超限任务 failed，结果含轮次上限；默认配置与注入配置均有用例。
- **AC2**：Codex 桥接在 `budget_turns=N` 下输出第 N+1 条轮次事件时，子进程被终止、返回 success=False、`metadata.budget_exceeded=true`，`events.jsonl` 有已捕获内容。
- **AC3**：`redact_content` 单测覆盖全部规则、None/空串、无敏感内容原样返回、多处替换、关闭开关后不替换。
- **AC4**：用户消息含 `sk-...` 时，存储的 message.content/task.description 为脱敏值，广播 payload 同样脱敏。
- **AC5**：orchestrator 结果消息与 TaskStep output 中的敏感值落库前被替换；model_call 的 error_message 同样脱敏。
- **AC6**：全量 pytest 通过；flake8 两条命令 0；前端无改动、无回归（本 PRD 不涉及前端）。

---

## 6. 数据模型与配置

- 无数据库迁移（纯行为层 + 配置项）。
- 新增 Settings：`content_redaction_enabled`、`agent_max_tool_iterations`（`.env.example` 同步注释，非必填）。

---

## 7. 架构与改动清单

| 模块 | 文件 | 改动 |
|---|---|---|
| 脱敏工具 | `backend/app/core/redaction.py` | 新增规则表与 `redact_content` |
| 配置 | `backend/app/core/config.py` | 新增两个配置项 |
| 内部预算 | `backend/app/core/orchestrator.py` | 工具循环使用配置上限；接入脱敏入口 |
| 桥接预算 | `backend/app/services/codex_bridge.py` | 流式计数轮次 + 超限终止进程树 |
| 集成落库 | `backend/app/services/integration_service.py` | 桥接结果落库/广播前脱敏 |
| 群聊入口 | `backend/app/core/message_hub.py` | 用户消息/节点任务落库前脱敏（路由仍用原文） |
| 测试 | `backend/tests/test_redaction.py`、`tests/test_codex_bridge.py`、`tests/test_orchestrator.py` 等 | 规则/入口/超限用例 |
| 文档 | `.env.example`、README 配置段（如有需要） | 标注两个配置 |

---

## 8. 里程碑

| 阶段 | 内容 |
|---|---|
| M1 | 脱敏模块 + 配置 + 单测（AC3） |
| M2 | 内部轮次预算 + 入口接入（AC1/AC5） |
| M3 | Codex 桥接轮次预算（AC2） |
| M4 | 集成桥接落库脱敏 + 全量回归（AC4/AC6） |

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 正则误伤正常文本（如普通单词 token） | 规则要求最小长度与边界；赋值类规则要求 key 名 + 分隔符 + ≥6 字符值；全量回归验证 |
| Codex CLI 事件类型随版本变化 | 事件识别做纯函数并兼容多种写法；识别失败只退化为「无轮次事件」而不崩溃；文档标注假设 |
| 脱敏导致用户排障信息丢失 | 只替换敏感值本身，保留上下文；可通过配置关闭 |
| 桥接流式改造影响取消/超时语义 | 保留原 wait/cancel 语义，新增测试覆盖 cancel/timeout 回归 |

---

*参考：docs/深度审查与推进计划报告-20260925.md §4.1（REQ-D4/REQ-D6）；docs/架构治理基线.md R-05 日志脱敏要求。*

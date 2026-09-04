# PRD：插件 Webhook 工具执行器 + 任务终态出站通知

> 类型：新需求（Requirement） ｜ 状态：已实施 ｜ 登记：变更追踪表 C-183

---

## 1. 背景与问题

插件系统的工具目前只有「声明」没有「执行」：`tools.py` 的插件工具执行边界（`register_plugin_tool_executor`）从未被真实执行器注册，默认执行器只会返回诚实的 "not implemented" 错误字符串。同时 `PluginToolDefinition` 已有 `endpoint/method` 字段，但缺少出站调用所需的 `headers`（鉴权头）与 `secret`（HMAC 签名密钥），导致插件工具无法安全地调用外部 HTTP 服务。

此外，任务到达终态（COMPLETED / FAILED）后系统没有任何出站通知能力，外部系统（如企业微信/飞书机器人、运维工单系统）无法感知任务结果，只能轮询 API。

## 2. 目标与非目标

**目标**
- G1：插件工具可真实执行——通过 httpx 向 `endpoint` 发起出站 HTTP 调用，返回响应文本给模型。
- G2：出站调用支持自定义 `headers` 与 HMAC-SHA256 签名（`X-Webhook-Signature`），密钥可配置在工具级 / manifest 级 / 工作区插件配置级。
- G3：任务进入终态时，向工作区插件配置的 webhook 地址推送结果通知；无配置则静默跳过。
- G4：通知失败只记日志，绝不影响任务主流程与状态变更事务。

**非目标**
- N1：不做 SSRF 防护白名单（内网部署场景，endpoint 由工作区管理员配置，Phase 3 可加）。
- N2：不做通知重试队列 / 离线补发（失败即放弃，仅记日志）。
- N3：不新增数据库表或列（配置全部存于现有 `manifest_json` / `config_json` JSON 内）。

## 3. 用户故事

- US1：管理员注册一个「工单查询」插件工具（endpoint + 鉴权头 + secret），Agent 在对话中被模型调用后能拿到真实外部系统数据。
- US2：外部系统管理员在内部群里收到「任务 #123 已完成」的 webhook 推送，无需打开控制台轮询。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | `PluginToolDefinition` 增加 `headers: dict[str, str]`、`secret: str`；`PluginManifest` 增加 `secret: str` | P0 |
| FR2 | 新建 `app/services/webhook.py`：`call_webhook(url, method, headers, body, secret, timeout=10)`，httpx 出站 + `X-Webhook-Signature: sha256=<hmac_hex(secret, body)>` + `asyncio.wait_for` 超时 + 网络错误/5xx 有界重试 | P0 |
| FR3 | `call_webhook` 永不抛异常：所有失败（超时/连接错误/非 2xx）记录日志并返回错误信息 | P0 |
| FR4 | `load_active_plugin_tools` 把 `headers` 与解析后的 `secret`（工具级 > manifest 级 > 工作区配置级）带入工具 record | P0 |
| FR5 | 注册全局真实 webhook 执行器替换默认 "not implemented" 占位执行器；`main.py` lifespan 与 `worker.py` 启动时各注册一次（幂等） | P0 |
| FR6 | 执行器从 record 组装 URL（endpoint 支持绝对地址或相对 base_url 拼接）、序列化参数为 JSON body、调用 `call_webhook`，把 HTTP 状态码与响应文本返回给模型 | P0 |
| FR7 | `orchestrator.update_task_status` 在 commit + broadcast 后，若状态为 COMPLETED/FAILED，调用 `_notify_task_terminal`：读取工作区已启用插件的 `config_json.webhook_url`，POST 任务终态摘要（task_id/title/status/result 摘要/时间），带 manifest secret 签名 | P1 |

## 5. 非功能需求（NFR）

- **安全**：secret 只用于签名，绝不出现在日志与返回给模型的结果中；签名覆盖完整 body 防篡改。
- **可靠性**：超时 10s 兜底；网络错误重试最多 2 次（指数退避 0.5s 起）；通知失败不影响任务状态。
- **兼容**：不新增 WS 事件、不改表结构；`requirements.txt` 新增 `httpx>=0.28,<1.0`（fastapi testclient 已依赖 httpx，无新增安装负担）。
- **可观测**：出站调用与通知均记结构化日志（含 plugin 名、URL 路径、状态码；不含 secret/header 值）。

## 6. 验收标准（AC）

- AC1：正确 secret 时 `X-Webhook-Signature` 与本地 `hmac.new(secret, body, sha256)` 一致；无 secret 时不出现在请求头。
- AC2：模拟超时 / 连接失败 / 非 2xx 响应，`call_webhook` 均不抛异常，返回可读错误信息并记日志。
- AC3：插件工具经 `execute_plugin_tool` 走真实执行器后，模型收到 `HTTP 200: <响应文本>` 形式的结果。
- AC4：任务置 COMPLETED 后，配置了 `webhook_url` 的工作区插件收到一次带正确签名的 POST；未配置的工作区零请求。
- AC5：`pytest backend/tests` 全绿（含新增 `test_webhook.py`）。

## 7. 数据与配置模型

无新表。字段全部落在既有 JSON 内：

- `manifest_json.tools[i].headers`：`{"Authorization": "Bearer xxx"}` 等请求头。
- `manifest_json.tools[i].secret` / `manifest_json.secret`：HMAC 密钥（工具级优先）。
- `workspace_plugins.config_json.webhook_url`：终态通知目标地址。
- `workspace_plugins.config_json.webhook_secret`（可选）：工作区级签名密钥兜底。

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | schema 加字段 + requirements 加 httpx | ✅ 完成 |
| M2 | webhook.py（签名/超时/重试/不抛异常） | ✅ 完成 |
| M3 | 执行器注册 + 启动接线（main/worker） | ✅ 完成 |
| M4 | orchestrator 终态出站通知 | ✅ 完成 |
| M5 | test_webhook.py 单测 + 全量回归 | ✅ 完成 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-183 | 已完成 | 待填 | LI | Requirement | 后端 | 插件工具 Webhook 真实执行器（httpx 出站 + HMAC 签名 + 超时重试）与任务终态出站通知，替换 not implemented 占位执行器 | - | schemas/plugin.py 加 headers/secret；新建 services/webhook.py；tools.py 执行器接线；orchestrator._notify_task_terminal | 否 | 否 | pytest 全绿（含新增 test_webhook.py） | PRD: docs/prd/PRD-插件Webhook执行器与出站通知.md |

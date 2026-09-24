# PRD：插件 Webhook 配置界面

> 类型：新需求（Requirement） ｜ 状态：已实施 ｜ 登记：变更追踪表 C-217

---

## 1. 背景与问题

C-183 已在后端落地「插件工具 Webhook 真实执行器」与「任务终态出站通知」：执行器从 `workspace_plugins.config_json.webhook_url` 读取目标地址、用 `config_json.webhook_secret` 做 HMAC-SHA256 签名。但配置这条链路只有后端能力，**前端 `src/` 全量搜索 `webhook` 零命中**——工作区管理员无法在界面上填写 / 修改 Webhook URL 与 Secret，只能手工改库，配置入口缺失导致该能力实际不可用。

同时后端只有 `POST .../plugins/{id}/toggle`（可顺带写 config），**没有独立的配置读/写端点**：界面上无法回显已保存的配置，也无法在不切换启停状态的前提下单独更新配置。

## 2. 目标与非目标

**目标**
- G1：新增插件配置读端点，管理员可在界面回显当前工作区某插件已保存的配置。
- G2：新增插件配置写端点，管理员可单独更新配置而不改变启停状态。
- G3：插件设置页提供 Webhook 配置弹窗（URL + Secret），读写均走后端并反馈结果。
- G4：配置读写限 Admin 及以上，写入记审计日志。

**非目标**
- N1：不新增数据库表或列（复用 `workspace_plugins.config_json`）。
- N2：不做配置项白名单 / schema 校验（配置为插件自定义 JSON，先透传）。
- N3：不做 Secret 掩码回显（仅 Admin 可读，与 Provider Key 管理页一致的可见性策略）。

## 3. 用户故事

- US1：工作区管理员在「设置 → 插件」页对已挂载插件点击「Webhook 配置」，填入外部系统的 Webhook URL 与签名 Secret 并保存；任务到达终态后外部系统收到带正确签名的通知。
- US2：管理员再次打开配置弹窗时，能看到上次保存的 URL / Secret，便于校对或更新。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 新增 `GET /api/v1/workspaces/{wid}/plugins/{pid}/config`，返回 `WorkspacePluginResponse`（含 `config`）；未挂载返回 404；仅 Admin 及以上 | P0 |
| FR2 | 新增 `PUT /api/v1/workspaces/{wid}/plugins/{pid}/config`，body `{config: {...}}`；插件不存在返回 404；未挂载时自动创建 `is_enabled=false` 的挂载记录仅存配置；仅 Admin 及以上 | P0 |
| FR3 | 配置写入后写审计日志（action `plugin.config_update`，detail 记录插件名与变更键名，不含值） | P0 |
| FR4 | 插件卡片在 `isInstalled && isAdmin` 时显示「Webhook 配置」按钮，打开弹窗 | P0 |
| FR5 | 弹窗打开时 GET 回显 `config.webhook_url` / `config.webhook_secret`；保存时 PUT `{config:{webhook_url, webhook_secret}}`，成功提示并刷新 | P0 |
| FR6 | 非管理员不显示配置按钮，沿用现有「仅管理员可配置」提示 | P1 |

## 5. 非功能需求（NFR）

- **安全**：读写端点均要求工作区 Admin 及以上；审计日志不记录 secret 值，只记键名。
- **兼容**：不新增表 / 列；`config_json` 既有结构与 C-183 通知读取路径完全一致，无需迁移。
- **一致性**：端点风格与既有 `toggle` 保持一致（`SuccessResponse[WorkspacePluginResponse]`）。
- **可观测**：配置变更进审计流水。

## 6. 验收标准（AC）

- AC1：未挂载插件 `GET .../config` 返回 404。
- AC2：`PUT .../config` 对未挂载插件自动创建 `is_enabled=false` 记录并保存配置，随后 `GET` 能读回。
- AC3：未知 `plugin_id` 的 `PUT` 返回 404。
- AC4：非 Admin 调用读/写返回 403（依赖 `require_workspace_role("admin")`）。
- AC5：前端弹窗可打开、回显、保存并提示；`npm run lint` / `npm run build` 通过。
- AC6：`pytest backend/tests/test_plugins.py` 全绿。

## 7. 数据与配置模型

无新表。复用 `workspace_plugins.config_json`：

- `config_json.webhook_url`：终态通知目标地址（C-183 消费）。
- `config_json.webhook_secret`：工作区级签名密钥兜底（C-183 消费）。

## 8. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 | 后端新增 GET/PUT config 端点 + schema | ✅ 完成 |
| M2 | 审计埋点 | ✅ 完成 |
| M3 | 前端配置弹窗 + 按钮 + 读写接线 | ✅ 完成 |
| M4 | 后端单测 + 前端 lint/build | ✅ 完成 |

## 9. 变更登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 待填 | C-217 | 已完成 | 待填 | LI | Requirement | 后端、前端 | 新增插件配置读/写端点与插件设置页 Webhook 配置弹窗，打通 C-183 出站通知的配置入口 | settings/plugins/page.tsx 配置弹窗与按钮；types/plugin.ts 复用 WorkspacePluginResponse | endpoints/plugins.py 新增 GET/PUT config + _workspace_plugin_response 辅助；schemas/plugin.py 新增 WorkspacePluginConfigUpdate；tests/test_plugins.py 新增用例 | 否 | 否 | test_plugins.py 2 passed；flake8 0；前端 lint 0 / build 成功 | PRD: docs/prd/PRD-插件Webhook配置界面.md |

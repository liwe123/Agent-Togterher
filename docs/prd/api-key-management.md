# PRD：设置页 API Key 管理（含收敛为 DeepSeek 预设 + 任意厂商）

> 类型：新需求（Requirement）｜状态：已实施｜关联提交：`19d4dca`（C-006）+ 演进 `abbb336`（C-015）

---

## 1. 背景与问题

MVP 阶段 API Key 只能通过环境变量（`.env`）配置，存在三个痛点：

1. **改 Key 要改配置 + 重启**：换一个 Provider 密钥必须编辑 `.env` 并重启服务，操作成本高、中断在线协作。
2. **解析路径单一**：密钥只能来自环境变量，无法在前端按需录入/替换。
3. **Provider 白名单写死**：列表预设了多个厂商，用户想接白名单外的厂商（如 Moonshot / Zhipu / x.ai）只能改代码或环境变量，且厂商名无法在前端维护。

### 本轮要解决的问题
1. 用户能在前端「设置 → API Key 管理」直接填入/删除各 Provider 密钥，无需重启。
2. 密钥解析优先级：**数据库 > 环境变量**（DB 存的是用户最新录入）。
3. **密钥安全**：列表接口永不含 Key 明文，只回传 `configured` 布尔；仅在用户显式点击眼睛时才按需取回。
4. **收敛预设 + 开放任意厂商**：只保留 DeepSeek 预设，其余任意厂商名由用户添加维护。

## 2. 目标与非目标

**目标**
- G1：前端可对任意 Provider 保存 / 删除 / 按需查看 API Key，全程无需改文件或重启。
- G2：`provider_credentials` 表存储密钥，DB 优先于环境变量解析。
- G3：列表/状态接口绝不泄露密钥明文。
- G4：预设仅 DeepSeek；用户可添加任意厂商（名称 ≤50 字符，显示 title-case）。

**非目标（N1-N3）**
- N1：不做密钥加密存储（本地优先工具，明文存 SQLite，README 注明安全边界）。
- N2：不做多用户/权限体系（本地单用户工具）。
- N3：不校验厂商名是否为真实 Provider（仅格式校验，未知厂商由 LiteLLM 调用时失败）。

## 3. 用户故事

- US1：作为用户，我在设置页粘贴 DeepSeek 密钥点保存，立即生效，无需重启；点删除即移除。
- US2：作为用户，我接入 `moonshot` 模型，在「添加厂商」输入 `moonshot` 与 Key，它出现在密钥列表并可被自定义模型选用。
- US3：作为用户，我想确认已保存的 Key 是否正确——点眼睛图标，输入框按需回填真实 Key，再点一次隐藏。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 新增 `provider_credentials` 表（provider 唯一、api_key、时间戳） | P0 |
| FR2 | `GET /api/provider-keys`：返回各 Provider 的 `configured` 状态（DB 或 env 已配），**不含 Key 值** | P0 |
| FR3 | `PUT /api/provider-keys/{provider}`：保存/覆盖密钥（provider 去空白、非空、≤50 字符） | P0 |
| FR4 | `DELETE /api/provider-keys/{provider}`：删除 DB 中的密钥 | P0 |
| FR5 | `GET /api/provider-keys/{provider}`：按需返回该 Provider 真实 Key（DB 优先，其次 env）——仅显式操作时调用 | P0 |
| FR6 | `chat_completion` 解析优先级：DB 密钥 > 环境变量；任意厂商名（不在 `_PROVIDER_KEY_FIELDS`）也走 DB 取值 | P0 |
| FR7 | 预设收敛为仅 DeepSeek；`/api/models/providers/status` 只显示 deepseek + DB 中已添加的厂商 | P0 |
| FR8 | 前端密钥管理 UI：密码框 + 眼睛切换（点击时拉取真实 Key 回填再显隐）+ 保存/删除按钮；「添加厂商」表单（任意厂商名 + Key） | P0 |
| FR9 | 状态融合：Provider 已配置 = env 或 DB 任一来源已配，状态卡片与模型卡片正确显示「已配置/未配置」 | P1 |

## 5. 非功能需求（NFR）

- **安全**：列表接口不回传密钥；`_sanitize_error_message` 对错误消息中的 Key 与 `sk-*` 模式做 `[REDACTED]` 替换；Key 不写日志。
- **隐私**：只有用户显式点击眼睛才经 `GET /api/provider-keys/{provider}` 取回真实 Key，取回即填、不常驻状态。
- **兼容**：沿用 `SuccessResponse[T]` 响应契约；API 行为变化（PUT 接受任意厂商名）在追踪表标注破坏性变更。
- **可用**：保存/删除带 loading 态与错误提示；输入框明/暗背景对比可读（含后续 c8d1f72 纯白文字修复）。

## 6. 验收标准（AC）

- AC1：设置页保存 Key → 刷新页面仍显示「已配置」；删除 → 「未配置」。
- AC2：DB 与 env 同时配置同一 Provider 时，调用使用 DB 密钥。
- AC3：`GET /api/provider-keys` 响应中**不含任何 `api_key` 字段值**。
- AC4：点眼睛从空输入框可回填真实已存 Key（此前 BUG：value 恒空只切类型）。
- AC5：添加厂商 `moonshot` + Key 后，它出现在 Provider 状态与密钥列表；未添加的预设（除 deepseek 外）不再出现。
- AC6：后端 pytest 全过（40→42）；`GET /api/provider-keys/{provider}` 仅显式操作可用。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | ProviderCredential 模型 + /api/provider-keys 增删查 + DB>env 解析 | 后端可用 |
| M2 | 前端密钥管理 UI（保存/删除/眼睛） | 设置页可用 |
| M3 | 眼睛取回真实 Key 修复（c374465） | BUG 修复 |
| M4 | 收敛预设 + 任意厂商添加（abbb336） | 演进完成 |

## 8. 变更追踪登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 21:17 | C-006 | 已完成 | [19d4dca](https://github.com/liwe123/Agent-Togterher/commit/19d4dca) | LI | Requirement | 后端、数据库、前端 | 新增「设置 → API Key 管理」：前端填入/删除各 Provider 密钥，存库优先于环境变量 | 设置页密钥 UI(密码框+眼睛+保存/删除)；use-settings 扩展 | ProviderCredential 模型；GET/PUT/DELETE /api/provider-keys；Key 解析优先级 DB>env | 是(provider_credentials) | 是 | 后端 37→40 | Key 永不在列表回传；新增表 |
| 2026-08-03 13:50 | C-015 | 已完成 | [abbb336](https://github.com/liwe123/Agent-Togterher/commit/abbb336) | LI | Requirement | 后端、前端 | API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API | 「添加厂商」表单(任意厂商名+Key)；厂商名 title-case；移除其余预设 | 移除 Provider 白名单；/models/providers/status 只显示 deepseek+DB 厂商 | 否(复用 provider_credentials) | 是 | 后端 40→42 | API 行为变化：PUT 接受任意厂商名 |

---

## 9. 已实施摘要（实施部分）

**关键文件**
- 后端：`backend/app/models/provider_credential.py`、`backend/app/api/v1/endpoints/provider_keys.py`、`backend/app/services/litellm_service.py`（`get_db_api_keys` / `is_provider_configured` / `get_api_key_value`）
- 前端：`frontend/src/components/settings/settings-page.tsx`、`frontend/src/hooks/use-settings.ts`、`frontend/src/types/settings.ts`

**验证结果**：后端 pytest 40→42 passed；`GET /api/provider-keys/{provider}` 显式取回行为有测试覆盖；列表永不含 Key。

**配套修复**：眼睛图标切换失效（c374465，点击时拉取真实 Key 再显隐）、输入框黑底黑字（a138831/c8d1f72）。

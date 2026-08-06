# PRD：自定义模型接入（任意 provider/model + fallback 降级）

> 类型：新需求（Requirement）｜状态：已实施｜关联提交：`48b3c47`（C-009）

---

## 1. 背景与问题

MVP 阶段模型只能来自 `config/models.yaml` 里写死的 5 个预设别名，用户想用
`models.yaml` 之外的模型（如 `openai/gpt-4o`、`anthropic/claude-sonnet-4`、或任意
小众 provider/model 组合）必须改 YAML 并重启。问题：

1. **不可热配**：加一个模型 = 改文件 + 重启，无法在运行中接入。
2. **不可独立配置降级**：预设模型的 fallback 链在 YAML 里，新增模型无法单独声明自己的降级目标。
3. **无连通性校验**：配置完不知道 Key/模型是否真的可用，只能等真跑任务时才发现。
4. **显示无区分**：设置页模型列表无法区分「预设」与「用户自定义」。

### 本轮要解决的问题
1. 前端可添加/删除任意 `provider/model` 组合，存库即生效，无需改 YAML 或重启。
2. 自定义模型可配置独立 fallback 降级链，`chat_completion` 按链调用。
3. 自定义模型可立即「测试连通性与延迟」，失败能给出原因。
4. 模型列表以「自定义」徽章区分自定义模型，并可被 Agent 绑定使用。

## 2. 目标与非目标

**目标**
- G1：`custom_model_configs` 表 + `/api/custom-models` 增删查，前端免重启接入任意模型。
- G2：`chat_completion` 运行时合并 DB 自定义模型（覆盖/补充 YAML 别名），fallback 链生效。
- G3：前端模型卡片支持一键「测试连通性与延迟」（复用 `/api/models/test`）。
- G4：自定义模型带「自定义」徽章，与 YAML 预设并列展示；名称唯一，冲突 409。

**非目标（N1-N2）**
- N1：不做模型下拉「自动发现」/ 联网型号列表（用户手动输入 provider/model ID）。
- N2：不校验模型 ID 真实性（由 LiteLLM 调用时失败并展示脱敏错误）。

## 3. 用户故事

- US1：作为用户，我在设置页点「添加自定义模型」，填名称/Provider/模型 ID/用途/Fallback，保存后模型立即出现在列表并被 Agent 绑定使用。
- US2：作为用户，我想验证某个模型连通性——点「测试连通性与延迟」，看到 provider/model/延迟/token/输出或明确失败原因。
- US3：作为用户，我的主模型不稳定——给自定义模型配一个 fallback 别名，主模型失败自动降级并在测试结果中标 `Fallback`。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 新增 `custom_model_configs` 表（name 唯一、provider、model、purpose、fallback_model、时间戳） | P0 |
| FR2 | `GET /api/custom-models`：返回全部自定义模型 | P0 |
| FR3 | `POST /api/custom-models`：创建；name 已存在返回 409（含并发冲突兜底 `commit_or_conflict`） | P0 |
| FR4 | `DELETE /api/custom-models/{name}`：删除（不存在 404） | P0 |
| FR5 | `chat_completion` 接收 `custom_models` 参数：把 DB 自定义模型并入模型配置（已存在的 YAML 别名不覆盖，其余追加），参与 `_fallback_chain` 解析 | P0 |
| FR6 | 前端添加表单：名称/Provider/模型 ID（必填）+ 用途 + Fallback（可选，选项来自现有模型名） | P0 |
| FR7 | 模型卡片「自定义」徽章 + 删除按钮；保留「测试连通性与延迟」能力 | P0 |
| FR8 | `GET /api/models/test`：POST 按 model_name 测试，返回 content/usage/latency/fallback_used/model_name | P0 |
| FR9 | 修复按 name 查主键的 BUG（此前按 name 过滤未命中主键路径导致查不到） | P1 |

## 5. 非功能需求（NFR）

- **一致性**：name 全局唯一；错误消息脱敏（不含 Key）；校验失败返回明确中文提示。
- **热配置**：添加/删除不重启即对后续任务生效（每次 `chat_completion` 从 DB 读取）。
- **可观测**：测试结果展示延迟/token/模型名/fallback 标记，失败展示原因。
- **兼容**：DB 自定义模型与 YAML 别名共用同一 `ModelConfig` 校验模型；fallback 循环检测（`_fallback_chain` 抛错）。

## 6. 验收标准（AC）

- AC1：POST 添加 `code_model`（openai/gpt-4o-mini，fallback=deepseek 别名）→ 列表出现且带「自定义」徽章；重复添加同名返回 409。
- AC2：`chat_completion("code_model", ...)` 使用 DB 配置，主模型失败时降级到 fallback 别名并标记 `fallback_used`。
- AC3：点「测试连通性与延迟」→ 成功展示 延迟/token/输出；Key 未配置或模型不可达 → 展示脱敏失败原因。
- AC4：删除自定义模型 → 列表移除；再调用该名称时回退 YAML 或报「Unknown model alias」。
- AC5：后端 pytest 全过（37→40，含自定义模型 CRUD/解析/集成）；`npm run lint && npm test && npm run build` 通过。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | CustomModelConfig 模型 + /api/custom-models 增删查 | 后端可用 |
| M2 | chat_completion 合并自定义模型 + fallback 链 + 主键查询修复 | 调用生效 |
| M3 | 前端添加表单 + 徽章 + 删除 + 测试连通性 | 设置页闭环 |
| M4 | 测试补齐（CRUD/解析/集成） | 验收 AC1-AC5 |

## 8. 变更追踪登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-02 23:28 | C-009 | 已完成 | [48b3c47](https://github.com/liwe123/Agent-Togterher/commit/48b3c47) | LI | Requirement | 后端、数据库、前端 | 新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效 | 自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复(undefined 与 React 批处理冲突) | CustomModelConfig 模型；/api/custom-models；chat_completion 自定义解析；修按 name 查 PK bug | 是(custom_model_configs) | 是 | 后端 37→40 | 新增表；含眼睛 BUG 修复 |

---

## 9. 已实施摘要（实施部分）

**关键文件**
- 后端：`backend/app/models/custom_model_config.py`、`backend/app/api/v1/endpoints/custom_models.py`、`backend/app/services/litellm_service.py`（`get_db_custom_models` / `chat_completion` 合并自定义配置）
- 前端：`frontend/src/components/settings/settings-page.tsx`、`frontend/src/hooks/use-settings.ts`、`frontend/src/types/settings.ts`

**验证结果**：后端 pytest 37→40 passed（自定义模型 CRUD、解析、集成）；lint/test/build 通过。

**配套修复**：API Key 眼睛图标切换失效（`undefined` 与 React 批处理冲突）、按 name 查主键 BUG。

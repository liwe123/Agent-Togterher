# Agent Console · PRD / 变更追踪

## 产品概述

Agent Console 是一个本地优先的多智能体协同运行台：Next.js 16 + FastAPI +
SQLite + LiteLLM + WebSocket。用户在群聊 `@Agent` 派发任务，后端自动编排
（Manager 拆解 → Worker 执行 → QA 审核 → 最终汇总），全程实时可视。

**核心页面**：运行总览 `/`、群聊 `/chats`、任务 `/tasks`、任务详情
`/tasks/[id]`、模型设置 `/settings`。

---

## 变更追踪表

> 约定：每次改动在完成并推送后，实时新增一行。ID 递增分配（工单号）。
> 改动类型：`Requirement`（新需求）/ `Optimization`（优化）/ `BUG`（修复）/
> `Docs`（文档）。

| 改动时间 | ID | 改动类型 | 前端技术 | 后端技术 | 是否有数据库 | 备注 |
|---|---|---|---|---|---|---|
| 2026-08-01 20:28 | C-001 | Optimization | 提取共用 `useWorkspaceSocket`；删除死代码（SystemStatus/SoftwareDock/selectConsoleAgents）；新增 ErrorBoundary；常量集中 `constants.ts`；任务工具函数去重 `task-utils.ts`；fetchedRef StrictMode 防护 | `TaskStepEventPayload` Schema 替代手写 dict；LiteLLM 响应提取模型成本；按工作区并发控制（max 3，429）；`MessageType.receipt` 标注预留 | 否 | 前端测试 2→28；净减 237 行 |
| 2026-08-01 20:31 | C-002 | Docs | README 全文中文化 | - | 否 | 全量翻译 |
| 2026-08-01 20:37 | C-003 | Docs | README 风格重写，含架构图 / 决策记录 | - | 否 | 资深工程师口吻 |
| 2026-08-01 21:17 | C-004 | Requirement | 设置页新增 API Key 管理 UI（密码框 + 眼睛 + 保存/删除）；`use-settings` 扩展 | `ProviderCredential` 模型；`GET/PUT/DELETE /api/provider-keys/{provider}`；Key 解析优先级 数据库 > 环境变量 | 是（`provider_credentials`） | Key 永不在列表回传 |
| 2026-08-01 21:20 | C-005 | Requirement | `start.bat` / `start.ps1` 一键启动脚本 | - | 否 | Docker Compose 封装；自动复制 .env + 等健康 |
| 2026-08-02 12:22 | C-006 | BUG | `next.config.ts` 写死 `output: standalone` 导致 dev server 端口不响应 | - | 否 | 改为 `NEXT_BUILD_STANDALONE` env 按需启用 |
| 2026-08-02 23:28 | C-007 | Requirement | 自定义模型添加/删除 UI；修复眼睛图标切换失效（`undefined` 与 React 批处理冲突） | `CustomModelConfig` 模型；`GET/POST/DELETE /api/custom-models`；`chat_completion` 注入自定义模型解析；修复按 name 查 PK 的 bug | 是（`custom_model_configs`） | 后端 37→40 测试 |
| 2026-08-02 23:33 | C-008 | Docs | README 补充「模型与密钥管理」章节 | - | 否 | 测试数更新 40/28 |
| 2026-08-02 23:36 | C-009 | BUG | 启动脚本 UTF-8 中文被 cmd/PowerShell 5.1 按 ANSI 解析导致乱码 | - | 否 | 改纯 ASCII |
| 2026-08-03 13:06 | C-010 | BUG | 设置页自定义模型表单 / API Key 输入框黑底黑字 | - | 否 | `text-foreground` 修复 |
| 2026-08-03 13:10 | C-011 | BUG | 表单字段文字改纯白 | - | 否 | `text-white` / white/90 |
| 2026-08-03 13:37 | C-012 | BUG | 点眼睛无法显示已保存 Key（保存后清空 + Key 不回传，value 恒空） | 新增 `GET /api/provider-keys/{provider}` 按需返回 Key 值；`get_api_key_value()` | 否 | 眼睛点击时拉取真实 Key 填充 |
| 2026-08-03 13:50 | C-013 | Requirement | API Key 管理只保留 DeepSeek 预设；新增「添加厂商」表单（任意厂商名 + Key）；厂商名自动 title-case | 移除 Provider 白名单，`PUT/GET/DELETE` 接受任意厂商；`/models/providers/status` 只显示 deepseek + DB 厂商 | 否（复用 `provider_credentials`） | 后端 40→42 测试 |
| 2026-08-03 14:05 | C-014 | Docs | 新增 `docs/PRD.md` 变更追踪表 | - | 否 | 建立本表，后续改动实时填写 |

---

## 后续维护约定

1. **每次改动完成并验证后**，在「变更追踪表」实时新增一行，ID 按 `C-XXX` 递增。
2. 若有数据库表新增/修改，在「是否有数据库」列填「是」，并在备注注明表名。
3. 前端技术 / 后端技术列只填关键技术与文件，不写过程细节。
4. 改动类型优先标注为 `Requirement` / `Optimization` / `BUG` / `Docs` 之一。
5. 重要技术决策（架构取舍）同步补充到 README 的「关键决策记录」。

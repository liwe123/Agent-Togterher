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

| 改动时间 | ID | 改动类型 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 备注 |
|---|---|---|---|---|---|---|---|
| 2026-08-01 20:28 | C-001 | Optimization | 全站优化：消除前端 4 处重复 WebSocket 逻辑与死代码，统一连接/任务工具/常量，增加 ErrorBoundary；后端事件契约规范化、记录模型成本、限制并发 | 提取共用 `useWorkspaceSocket`；删除死代码（SystemStatus/SoftwareDock/selectConsoleAgents）；新增 ErrorBoundary；常量集中 `constants.ts`；任务工具函数去重 `task-utils.ts`；fetchedRef StrictMode 防护 | `TaskStepEventPayload` Schema 替代手写 dict；LiteLLM 响应提取模型成本；按工作区并发控制（max 3，429）；`MessageType.receipt` 标注预留 | 否 | 前端测试 2→28；净减 237 行 |
| 2026-08-01 20:31 | C-002 | Docs | README 全文中文化 | README 全量翻译 | - | 否 | 全量翻译 |
| 2026-08-01 20:37 | C-003 | Docs | README 风格重写，加入架构图与关键决策记录 | README 结构重排、徽章、ASCII 架构图 | - | 否 | 资深工程师口吻 |
| 2026-08-01 21:17 | C-004 | Requirement | 新增「设置 → API Key 管理」：用户可在前端填入/删除各 Provider 密钥，存库优先于环境变量 | 设置页 API Key 管理 UI（密码框 + 眼睛 + 保存/删除）；`use-settings` 扩展 | `ProviderCredential` 模型；`GET/PUT/DELETE /api/provider-keys/{provider}`；Key 解析优先级 数据库 > 环境变量 | 是（`provider_credentials`） | Key 永不在列表回传 |
| 2026-08-01 21:20 | C-005 | Requirement | 新增 Windows 一键启动脚本 | `start.bat` / `start.ps1` | - | 否 | Docker Compose 封装；自动复制 .env + 等健康 |
| 2026-08-02 12:22 | C-006 | BUG | 修复开发服务器端口无法访问（`next.config.ts` standalone 配置与 dev 冲突） | `output: standalone` 改为 `NEXT_BUILD_STANDALONE` env 按需启用 | - | 否 | 仅生产 Docker 构建时启用 |
| 2026-08-02 23:28 | C-007 | Requirement | 新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效 | 自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复（`undefined` 与 React 批处理冲突） | `CustomModelConfig` 模型；`GET/POST/DELETE /api/custom-models`；`chat_completion` 注入自定义模型解析；修复按 name 查 PK 的 bug | 是（`custom_model_configs`） | 后端 37→40 测试 |
| 2026-08-02 23:33 | C-008 | Docs | README 补充「模型与密钥管理」章节，更新测试数 | README 章节补充 | - | 否 | 测试数更新 40/28 |
| 2026-08-02 23:36 | C-009 | BUG | 修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析） | 脚本消息改纯 ASCII | - | 否 | 跨代码页安全 |
| 2026-08-03 13:06 | C-010 | BUG | 修复设置页自定义模型表单 / API Key 输入框黑底黑字无法阅读 | `text-foreground` 修复 | - | 否 | - |
| 2026-08-03 13:10 | C-011 | BUG | 设置页表单字段文字改纯白，提升可读性 | `text-white` / white/90 / 占位符 white/40 | - | 否 | - |
| 2026-08-03 13:37 | C-012 | BUG | 修复点击眼睛无法显示已保存 API Key（保存后清空 + Key 不回传，value 恒空） | 眼睛点击时拉取真实 Key 填充输入框再切换可见性 | 新增 `GET /api/provider-keys/{provider}` 按需返回 Key 值；`get_api_key_value()` | 否 | 显式操作才返回 Key，列表仍不回传 |
| 2026-08-03 13:50 | C-013 | Requirement | API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API | 「添加厂商」表单（任意厂商名 + Key）；厂商名自动 title-case；移除其余预设 | 移除 Provider 白名单，`PUT/GET/DELETE` 接受任意厂商；`/models/providers/status` 只显示 deepseek + DB 厂商 | 否（复用 `provider_credentials`） | 后端 40→42 测试 |
| 2026-08-03 14:05 | C-014 | Docs | 新增 `docs/PRD.md` 变更追踪表 | 表格 + 维护约定 | - | 否 | 建立本表，后续改动实时填写 |
| 2026-08-03 14:15 | C-015 | Docs | 变更追踪表新增「改动内容」列，明确记录每次改了什么 | 表结构更新（PRD.md + Excel） | - | 否 | 业务描述与前后端技术分离 |

---

## 后续维护约定

1. **每次改动完成并验证后**，在「变更追踪表」实时新增一行，ID 按 `C-XXX` 递增。
2. 若有数据库表新增/修改，在「是否有数据库」列填「是」，并在备注注明表名。
3. 前端技术 / 后端技术列只填关键技术与文件，不写过程细节。
4. 改动类型优先标注为 `Requirement` / `Optimization` / `BUG` / `Docs` 之一。
5. 重要技术决策（架构取舍）同步补充到 README 的「关键决策记录」。

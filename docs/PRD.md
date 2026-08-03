# Agent Console · PRD / 变更追踪

## 产品概述

Agent Console 是一个本地优先的多智能体协同运行台：Next.js 16 + FastAPI +
SQLite + LiteLLM + WebSocket。用户在群聊 `@Agent` 派发任务，后端自动编排
（Manager 拆解 → Worker 执行 → QA 审核 → 最终汇总），全程实时可视。

**核心页面**：运行总览 `/`、群聊 `/chats`、任务 `/tasks`、任务详情
`/tasks/[id]`、模型设置 `/settings`。

---

## 变更追踪表

> 约定：表格由 `docs/generate_change_log.py` 从 git history 自动生成。
> ID 递增分配（工单号）。改动类型：`Requirement`（新需求）/
> `Optimization`（优化）/ `BUG`（修复）/ `Docs`（文档）。
> 新提交自动推断列；需补充细节时在脚本 `CURATED` 字典按 commit sha 填写。

<!-- CHANGELOG:START -->
| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 20:28 | C-001 | 已完成 | [08ed038](https://github.com/liwe123/Agent-Togterher/commit/08ed038) | LI | Optimization | 后端、数据库、前端 | 全站优化：消除前端 4 处重复 WebSocket 逻辑与死代码，统一连接/任务工具/常量，增加 ErrorBoundary；后端事件契约规范化、记录模型成本、限制并发 | 提取共用 useWorkspaceSocket；删除死代码(SystemStatus/SoftwareDock/selectConsoleAgents)；新增 ErrorBoundary；常量集中 constants.ts；任务工具去重 task-utils.ts；fetchedRef 防护 | TaskStepEventPayload Schema 替代手写 dict；LiteLLM 响应提取成本；并发控制(max 3, 429)；receipt 标注预留 | 否 | 否 | 前端测试 2→28；净减 237 行 | 仅前端组件 + 后端工具函数改动，无外部 API 变化 |
| 2026-08-01 20:31 | C-002 | 已完成 | [8ab4834](https://github.com/liwe123/Agent-Togterher/commit/8ab4834) | LI | Docs | 文档 | README 更新本轮优化详情 | README 章节补充 | - | 否 | 否 | - | 测试数 37/28 |
| 2026-08-01 20:33 | C-003 | 已完成 | [5f3b6a1](https://github.com/liwe123/Agent-Togterher/commit/5f3b6a1) | LI | Docs | 文档 | README 全文中文化 | README 全量翻译 | - | 否 | 否 | - | 全量翻译 |
| 2026-08-01 20:37 | C-004 | 已完成 | [3a99015](https://github.com/liwe123/Agent-Togterher/commit/3a99015) | LI | Docs | 文档 | README 风格重写，加入架构图与关键决策记录 | README 结构重排、徽章、ASCII 架构图 | - | 否 | 否 | - | 资深工程师口吻 |
| 2026-08-01 20:55 | C-005 | 已完成 | [9c2dd0e](https://github.com/liwe123/Agent-Togterher/commit/9c2dd0e) | LI | Requirement | 其他、配置、文档、前端 | 前端视觉与响应式优化，新增通讯录 /contacts 页面与 Agent 头像组件 | 新增 agent-portrait.tsx、contacts-page.tsx(/contacts 路由)；agent-gallery/status-panel/app-sidebar/chat 组件重构；globals.css 视觉令牌与响应式优化 | - | 否 | 否 | - | 1203 插入/471 删除，21 文件；经 C-021 并入当前分支；PRD: docs/prd/visual-aesthetics.md |
| 2026-08-01 21:17 | C-006 | 已完成 | [19d4dca](https://github.com/liwe123/Agent-Togterher/commit/19d4dca) | LI | Requirement | 后端、数据库、前端 | 新增「设置 → API Key 管理」：用户可在前端填入/删除各 Provider 密钥，存库优先于环境变量 | 设置页 API Key 管理 UI(密码框+眼睛+保存/删除)；use-settings 扩展 | ProviderCredential 模型；GET/PUT/DELETE /api/provider-keys；Key 解析优先级 DB>env | 是(provider_credentials) | 是 | 后端 37→40 | Key 永不在列表回传；新增表；PRD: docs/prd/api-key-management.md |
| 2026-08-01 21:20 | C-007 | 已完成 | [fb94fb2](https://github.com/liwe123/Agent-Togterher/commit/fb94fb2) | LI | Requirement | 部署 | 新增 Windows 一键启动脚本 | start.bat / start.ps1 | - | 否 | 否 | - | Docker Compose 封装；自动复制 .env + 等健康；PRD: docs/prd/launch-scripts.md |
| 2026-08-02 12:22 | C-008 | 已完成 | [f6ac2e8](https://github.com/liwe123/Agent-Togterher/commit/f6ac2e8) | LI | BUG | 前端 | 修复开发服务器端口无法访问（next.config standalone 配置与 dev 冲突） | output:standalone 改为 NEXT_BUILD_STANDALONE env 按需启用 | - | 否 | 否 | build pass | 仅生产 Docker 构建启用 |
| 2026-08-02 23:28 | C-009 | 已完成 | [48b3c47](https://github.com/liwe123/Agent-Togterher/commit/48b3c47) | LI | Requirement | 后端、数据库、前端 | 新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效 | 自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复(undefined 与 React 批处理冲突) | CustomModelConfig 模型；/api/custom-models；chat_completion 自定义解析；修按 name 查 PK bug | 是(custom_model_configs) | 是 | 后端 37→40 | 新增表；含眼睛 BUG 修复；PRD: docs/prd/custom-models.md |
| 2026-08-02 23:33 | C-010 | 已完成 | [5b5e5d9](https://github.com/liwe123/Agent-Togterher/commit/5b5e5d9) | LI | Docs | 文档 | README 补充「模型与密钥管理」章节，更新测试数 | README 章节补充 | - | 否 | 否 | - | 测试数 40/28 |
| 2026-08-02 23:36 | C-011 | 已完成 | [4396cad](https://github.com/liwe123/Agent-Togterher/commit/4396cad) | LI | BUG | 部署 | 修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析） | 脚本消息改纯 ASCII | - | 否 | 否 | - | 跨代码页安全 |
| 2026-08-03 13:06 | C-012 | 已完成 | [a138831](https://github.com/liwe123/Agent-Togterher/commit/a138831) | LI | BUG | 前端 | 修复设置页自定义模型表单 / API Key 输入框黑底黑字无法阅读 | text-foreground 修复 | - | 否 | 否 | - | - |
| 2026-08-03 13:10 | C-013 | 已完成 | [c8d1f72](https://github.com/liwe123/Agent-Togterher/commit/c8d1f72) | LI | BUG | 前端 | 设置页表单字段文字改纯白，提升可读性 | text-white / white/90 / 占位符 white/40 | - | 否 | 否 | - | - |
| 2026-08-03 13:37 | C-014 | 已完成 | [c374465](https://github.com/liwe123/Agent-Togterher/commit/c374465) | LI | BUG | 后端、前端 | 修复点击眼睛无法显示已保存 API Key（保存后清空 + Key 不回传，value 恒空） | 眼睛点击时拉取真实 Key 填充输入框再切换可见性 | 新增 GET /api/provider-keys/{provider} 按需返回 Key；get_api_key_value() | 否 | 否 | 后端 42 passed | 显式操作才返回 Key，列表仍不回传 |
| 2026-08-03 13:50 | C-015 | 已完成 | [abbb336](https://github.com/liwe123/Agent-Togterher/commit/abbb336) | LI | Requirement | 后端、前端 | API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API | 「添加厂商」表单(任意厂商名+Key)；厂商名 title-case；移除其余预设 | 移除 Provider 白名单；/models/providers/status 只显示 deepseek+DB 厂商 | 否(复用 provider_credentials) | 是 | 后端 40→42 | API 行为变化：PUT 接受任意厂商名；PRD: docs/prd/api-key-management.md |
| 2026-08-03 13:56 | C-016 | 已完成 | [6289107](https://github.com/liwe123/Agent-Togterher/commit/6289107) | LI | Docs | 文档 | 新增 docs/PRD.md 变更追踪表 | 表格 + 维护约定 | - | 否 | 否 | - | 建立本表，后续由脚本实时生成 |
| 2026-08-03 13:59 | C-017 | 已完成 | [fc35e0b](https://github.com/liwe123/Agent-Togterher/commit/fc35e0b) | LI | Docs | 其他 | 新增 Excel 变更追踪工作簿 | openpyxl 生成脚本 | - | 否 | 否 | - | 表结构含颜色/冻结/筛选 |
| 2026-08-03 14:01 | C-018 | 已完成 | [2ba41fc](https://github.com/liwe123/Agent-Togterher/commit/2ba41fc) | LI | Docs | 其他、文档 | 变更追踪表新增「改动内容」列，明确记录每次改了什么 | 表结构更新(PRD.md + Excel) | - | 否 | 否 | - | 业务描述与前后端技术分离 |
| 2026-08-03 14:04 | C-019 | 已完成 | [3049af9](https://github.com/liwe123/Agent-Togterher/commit/3049af9) | LI | Docs | 其他、文档 | 变更追踪表改为从 git history 自动生成 | generate_change_log.py（爬取 git log + 自动推断列 + CURATED 人工覆盖 + 生成 PRD/Excel） | - | 否 | 否 | - | 新提交自动生成行；已知提交按 sha 覆盖 |
| 2026-08-03 14:10 | C-020 | 已完成 | [0bde63b](https://github.com/liwe123/Agent-Togterher/commit/0bde63b) | LI | Docs | 其他、文档 | 变更追踪表收录独立主线的视觉重构提交（C-005） | generate_change_log.py 支持 EXTRA_SHAS + 按 subject 覆盖 | - | 否 | 否 | - | 9c2dd0e 强推覆盖后归位 |
| 2026-08-03 14:36 | C-021 | 已完成 | [0c46b78](https://github.com/liwe123/Agent-Togterher/commit/0c46b78) | LI | Requirement | 其他 | 合并视觉重构提交 9c2dd0e（A/B 测试通过）：新增 /contacts 通讯录页、agent-portrait 头像组件、恢复 software-dock；globals.css 视觉与响应式优化；设置页与 API Key/自定义模型功能共存 | 合并 settings-page.tsx（保留 API Key 管理 + 自定义模型功能并采用视觉样式）；新增 contacts 路由、agent-portrait.tsx、software-dock.tsx 恢复；agent-gallery/status-panel/app-sidebar/chat 视觉重构 | - | 否 | 否 | lint/test/build/pytest 全过(42) | 仅 settings-page.tsx 1 处文本冲突手工合并；PRD: docs/prd/visual-aesthetics.md |
| 2026-08-03 14:38 | C-022 | 已完成 | [ffe1535](https://github.com/liwe123/Agent-Togterher/commit/ffe1535) | LI | Docs | 其他、文档 | docs: record merge C-021 (visual aesthetics A/B test) in change log | - | - | 否 | 否 | - | - |
| 2026-08-03 15:06 | C-023 | 已完成 | [d64090a](https://github.com/liwe123/Agent-Togterher/commit/d64090a) | LI | Docs | 其他、文档 | docs: add Git commit column to change log | - | - | 否 | 否 | - | - |
| 2026-08-03 15:09 | C-024 | 已完成 | [08b8e10](https://github.com/liwe123/Agent-Togterher/commit/08b8e10) | LI | Docs | 其他、文档 | docs: expand change log to professional 14-column layout | - | - | 否 | 否 | - | - |
| 2026-08-03 20:38 | C-025 | 已完成 | [36854c8](https://github.com/liwe123/Agent-Togterher/commit/36854c8) | LI | Requirement | 后端、其他、前端 | 为 Agent 增加工具调用（Function Calling）能力：chat_completion 支持 tools + tool_calls；新增工具注册表（calculate/query_tasks/get_agents/get_system_status）；orchestrator 工具循环（最大 5 轮）并持久化为 TaskStep；单 Agent 与 Worker 阶段启用 | task-format.ts stepLabel 增加「工具调用」映射 | litellm_service 支持 tools/tool_calls；新增 services/tools.py 注册表+安全计算；orchestrator 工具循环+TaskStep 持久化；config 新增 agent_tools_enabled | 否 | 否 | pytest 42→54；前端 28/build pass | 详见 docs/prd/PRD-工具调用能力.md；不新增 WS 事件、不改表结构 |
| 2026-08-03 20:39 | C-026 | 已完成 | [e4c9e20](https://github.com/liwe123/Agent-Togterher/commit/e4c9e20) | LI | Docs | 其他、文档 | docs: register tool-calling requirement C-025 in change log | - | - | 否 | 否 | - | - |
| 2026-08-03 20:41 | C-027 | 已完成 | [dab7448](https://github.com/liwe123/Agent-Togterher/commit/dab7448) | LI | Docs | 文档 | 为 5 个历史需求（Agent Console MVP / API Key 管理 / 自定义模型 / 前端视觉与响应式优化 / Windows 一键启动）补充详细 PRD 文档到 docs/prd/，并在追踪表对应行备注 PRD 链接 | 新增 docs/prd/agent-console-mvp.md、api-key-management.md、custom-models.md、visual-aesthetics.md、launch-scripts.md | generate_change_log.py CURATED 备注追加 PRD 链接 | 否 | 否 | - | docs/PRD.md 增补「PRD 文档索引」；MVP 为基线前需求，以其 PRD 文档登记 |
| 2026-08-03 20:43 | C-028 | 已完成 | [958563f](https://github.com/liwe123/Agent-Togterher/commit/958563f) | LI | Docs | 文档 | docs: 登记 PRD 文档提交并加固变更追踪生成脚本 | - | - | 否 | 否 | - | - |
<!-- CHANGELOG:END -->

---

## PRD 文档索引

历史需求的详细 PRD（背景/目标/用户故事/FR/NFR/AC/里程碑）存放于 `docs/prd/`：

| PRD 文档 | 需求 | 关联提交 | 追踪表 |
|----------|------|----------|--------|
| [agent-console-mvp.md](prd/agent-console-mvp.md) | Agent Console MVP（多智能体协同运行台） | 599e268（+ca6322d、0a27d86） | 基线前 |
| [PRD-工具调用能力.md](prd/PRD-工具调用能力.md) | Agent 工具调用（Function Calling） | 36854c8 | C-025 |
| [api-key-management.md](prd/api-key-management.md) | 设置页 API Key 管理（DeepSeek 预设 + 任意厂商） | 19d4dca、abbb336 | C-006、C-015 |
| [custom-models.md](prd/custom-models.md) | 自定义模型接入（任意 provider/model + fallback 降级） | 48b3c47 | C-009 |
| [visual-aesthetics.md](prd/visual-aesthetics.md) | 前端视觉与响应式优化 + /contacts 通讯录页 | 9c2dd0e、0c46b78 | C-005、C-021 |
| [launch-scripts.md](prd/launch-scripts.md) | Windows 一键启动脚本 | fb94fb2 | C-007 |

---

## 后续维护约定

1. **每次改动完成并推送后**，运行 `python docs/generate_change_log.py` 重新生成
   本表与 Excel（自动从 git history 爬取，ID 按 `C-XXX` 递增）。
2. 自动推断的新行（类型按 commit 前缀、前后端/数据库按变更路径）较粗略；
   如需补充细节，在脚本 `CURATED` 字典按 commit sha 填写后重新运行。
3. 有数据库表新增/修改时，「是否有数据库」列填「是」并注明表名。
4. 改动类型限定 `Requirement` / `Optimization` / `BUG` / `Docs` 之一。
5. 重要技术决策（架构取舍）同步补充到 README 的「关键决策记录」。

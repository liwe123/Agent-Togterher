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
| 2026-08-01 20:55 | C-005 | 已完成 | [9c2dd0e](https://github.com/liwe123/Agent-Togterher/commit/9c2dd0e) | LI | Requirement | 其他、配置、文档、前端 | 前端视觉与响应式优化，新增通讯录 /contacts 页面与 Agent 头像组件 | 新增 agent-portrait.tsx、contacts-page.tsx(/contacts 路由)；agent-gallery/status-panel/app-sidebar/chat 组件重构；globals.css 视觉令牌与响应式优化 | - | 否 | 否 | - | 1203 插入/471 删除，21 文件；经 C-021 并入当前分支；PRD: docs/prd/PRD-前端视觉与响应式优化.md |
| 2026-08-01 21:17 | C-006 | 已完成 | [19d4dca](https://github.com/liwe123/Agent-Togterher/commit/19d4dca) | LI | Requirement | 后端、数据库、前端 | 新增「设置 → API Key 管理」：用户可在前端填入/删除各 Provider 密钥，存库优先于环境变量 | 设置页 API Key 管理 UI(密码框+眼睛+保存/删除)；use-settings 扩展 | ProviderCredential 模型；GET/PUT/DELETE /api/provider-keys；Key 解析优先级 DB>env | 是(provider_credentials) | 是 | 后端 37→40 | Key 永不在列表回传；新增表；PRD: docs/prd/PRD-APIKey管理.md |
| 2026-08-01 21:20 | C-007 | 已完成 | [fb94fb2](https://github.com/liwe123/Agent-Togterher/commit/fb94fb2) | LI | Requirement | 部署 | 新增 Windows 一键启动脚本 | start.bat / start.ps1 | - | 否 | 否 | - | Docker Compose 封装；自动复制 .env + 等健康；PRD: docs/prd/PRD-Windows一键启动脚本.md |
| 2026-08-02 12:22 | C-008 | 已完成 | [f6ac2e8](https://github.com/liwe123/Agent-Togterher/commit/f6ac2e8) | LI | BUG | 前端 | 修复开发服务器端口无法访问（next.config standalone 配置与 dev 冲突） | output:standalone 改为 NEXT_BUILD_STANDALONE env 按需启用 | - | 否 | 否 | build pass | 仅生产 Docker 构建启用 |
| 2026-08-02 23:28 | C-009 | 已完成 | [48b3c47](https://github.com/liwe123/Agent-Togterher/commit/48b3c47) | LI | Requirement | 后端、数据库、前端 | 新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效 | 自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复(undefined 与 React 批处理冲突) | CustomModelConfig 模型；/api/custom-models；chat_completion 自定义解析；修按 name 查 PK bug | 是(custom_model_configs) | 是 | 后端 37→40 | 新增表；含眼睛 BUG 修复；PRD: docs/prd/PRD-自定义模型接入.md |
| 2026-08-02 23:33 | C-010 | 已完成 | [5b5e5d9](https://github.com/liwe123/Agent-Togterher/commit/5b5e5d9) | LI | Docs | 文档 | README 补充「模型与密钥管理」章节，更新测试数 | README 章节补充 | - | 否 | 否 | - | 测试数 40/28 |
| 2026-08-02 23:36 | C-011 | 已完成 | [4396cad](https://github.com/liwe123/Agent-Togterher/commit/4396cad) | LI | BUG | 部署 | 修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析） | 脚本消息改纯 ASCII | - | 否 | 否 | - | 跨代码页安全 |
| 2026-08-03 13:06 | C-012 | 已完成 | [a138831](https://github.com/liwe123/Agent-Togterher/commit/a138831) | LI | BUG | 前端 | 修复设置页自定义模型表单 / API Key 输入框黑底黑字无法阅读 | text-foreground 修复 | - | 否 | 否 | - | - |
| 2026-08-03 13:10 | C-013 | 已完成 | [c8d1f72](https://github.com/liwe123/Agent-Togterher/commit/c8d1f72) | LI | BUG | 前端 | 设置页表单字段文字改纯白，提升可读性 | text-white / white/90 / 占位符 white/40 | - | 否 | 否 | - | - |
| 2026-08-03 13:37 | C-014 | 已完成 | [c374465](https://github.com/liwe123/Agent-Togterher/commit/c374465) | LI | BUG | 后端、前端 | 修复点击眼睛无法显示已保存 API Key（保存后清空 + Key 不回传，value 恒空） | 眼睛点击时拉取真实 Key 填充输入框再切换可见性 | 新增 GET /api/provider-keys/{provider} 按需返回 Key；get_api_key_value() | 否 | 否 | 后端 42 passed | 显式操作才返回 Key，列表仍不回传 |
| 2026-08-03 13:50 | C-015 | 已完成 | [abbb336](https://github.com/liwe123/Agent-Togterher/commit/abbb336) | LI | Requirement | 后端、前端 | API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API | 「添加厂商」表单(任意厂商名+Key)；厂商名 title-case；移除其余预设 | 移除 Provider 白名单；/models/providers/status 只显示 deepseek+DB 厂商 | 否(复用 provider_credentials) | 是 | 后端 40→42 | API 行为变化：PUT 接受任意厂商名；PRD: docs/prd/PRD-APIKey管理.md |
| 2026-08-03 13:56 | C-016 | 已完成 | [6289107](https://github.com/liwe123/Agent-Togterher/commit/6289107) | LI | Docs | 文档 | 新增 docs/PRD.md 变更追踪表 | 表格 + 维护约定 | - | 否 | 否 | - | 建立本表，后续由脚本实时生成 |
| 2026-08-03 13:59 | C-017 | 已完成 | [fc35e0b](https://github.com/liwe123/Agent-Togterher/commit/fc35e0b) | LI | Docs | 其他 | 新增 Excel 变更追踪工作簿 | openpyxl 生成脚本 | - | 否 | 否 | - | 表结构含颜色/冻结/筛选 |
| 2026-08-03 14:01 | C-018 | 已完成 | [2ba41fc](https://github.com/liwe123/Agent-Togterher/commit/2ba41fc) | LI | Docs | 其他、文档 | 变更追踪表新增「改动内容」列，明确记录每次改了什么 | 表结构更新(PRD.md + Excel) | - | 否 | 否 | - | 业务描述与前后端技术分离 |
| 2026-08-03 14:04 | C-019 | 已完成 | [3049af9](https://github.com/liwe123/Agent-Togterher/commit/3049af9) | LI | Docs | 其他、文档 | 变更追踪表改为从 git history 自动生成 | generate_change_log.py（爬取 git log + 自动推断列 + CURATED 人工覆盖 + 生成 PRD/Excel） | - | 否 | 否 | - | 新提交自动生成行；已知提交按 sha 覆盖 |
| 2026-08-03 14:10 | C-020 | 已完成 | [0bde63b](https://github.com/liwe123/Agent-Togterher/commit/0bde63b) | LI | Docs | 其他、文档 | 变更追踪表收录独立主线的视觉重构提交（C-005） | generate_change_log.py 支持 EXTRA_SHAS + 按 subject 覆盖 | - | 否 | 否 | - | 9c2dd0e 强推覆盖后归位 |
| 2026-08-03 14:36 | C-021 | 已完成 | [0c46b78](https://github.com/liwe123/Agent-Togterher/commit/0c46b78) | LI | Requirement | 其他 | 合并视觉重构提交 9c2dd0e（A/B 测试通过）：新增 /contacts 通讯录页、agent-portrait 头像组件、恢复 software-dock；globals.css 视觉与响应式优化；设置页与 API Key/自定义模型功能共存 | 合并 settings-page.tsx（保留 API Key 管理 + 自定义模型功能并采用视觉样式）；新增 contacts 路由、agent-portrait.tsx、software-dock.tsx 恢复；agent-gallery/status-panel/app-sidebar/chat 视觉重构 | - | 否 | 否 | lint/test/build/pytest 全过(42) | 仅 settings-page.tsx 1 处文本冲突手工合并；PRD: docs/prd/PRD-前端视觉与响应式优化.md |
| 2026-08-03 14:38 | C-022 | 已完成 | [ffe1535](https://github.com/liwe123/Agent-Togterher/commit/ffe1535) | LI | Docs | 其他、文档 | docs: record merge C-021 (visual aesthetics A/B test) in change log | - | - | 否 | 否 | - | - |
| 2026-08-03 15:06 | C-023 | 已完成 | [d64090a](https://github.com/liwe123/Agent-Togterher/commit/d64090a) | LI | Docs | 其他、文档 | docs: add Git commit column to change log | - | - | 否 | 否 | - | - |
| 2026-08-03 15:09 | C-024 | 已完成 | [08b8e10](https://github.com/liwe123/Agent-Togterher/commit/08b8e10) | LI | Docs | 其他、文档 | docs: expand change log to professional 14-column layout | - | - | 否 | 否 | - | - |
| 2026-08-03 20:38 | C-025 | 已完成 | [36854c8](https://github.com/liwe123/Agent-Togterher/commit/36854c8) | LI | Requirement | 后端、其他、前端 | 为 Agent 增加工具调用（Function Calling）能力：chat_completion 支持 tools + tool_calls；新增工具注册表（calculate/query_tasks/get_agents/get_system_status）；orchestrator 工具循环（最大 5 轮）并持久化为 TaskStep；单 Agent 与 Worker 阶段启用 | task-format.ts stepLabel 增加「工具调用」映射 | litellm_service 支持 tools/tool_calls；新增 services/tools.py 注册表+安全计算；orchestrator 工具循环+TaskStep 持久化；config 新增 agent_tools_enabled | 否 | 否 | pytest 42→54；前端 28/build pass | 详见 docs/prd/PRD-工具调用能力.md；不新增 WS 事件、不改表结构 |
| 2026-08-03 20:39 | C-026 | 已完成 | [e4c9e20](https://github.com/liwe123/Agent-Togterher/commit/e4c9e20) | LI | Docs | 其他、文档 | docs: register tool-calling requirement C-025 in change log | - | - | 否 | 否 | - | - |
| 2026-08-03 20:54 | C-027 | 已完成 | [8716e45](https://github.com/liwe123/Agent-Togterher/commit/8716e45) | LI | Docs | 其他、文档 | 为 5 个历史需求（Agent Console MVP / API Key 管理 / 自定义模型 / 前端视觉与响应式优化 / Windows 一键启动）补充详细 PRD 文档到 docs/prd/，并在追踪表对应行备注 PRD 链接 | 新增 docs/prd/PRD-AgentConsoleMVP.md、PRD-APIKey管理.md、PRD-自定义模型接入.md、PRD-前端视觉与响应式优化.md、PRD-Windows一键启动脚本.md | generate_change_log.py CURATED 备注追加 PRD 链接 | 否 | 否 | - | docs/PRD.md 增补「PRD 文档索引」；MVP 为基线前需求，以其 PRD 文档登记 |
| 2026-08-03 20:56 | C-028 | 已完成 | [197f6e3](https://github.com/liwe123/Agent-Togterher/commit/197f6e3) | LI | Docs | 其他、文档 | docs: 变更追踪表登记 PRD 文档提交 | - | - | 否 | 否 | - | - |
| 2026-08-03 20:56 | C-029 | 已完成 | [2313960](https://github.com/liwe123/Agent-Togterher/commit/2313960) | LI | Docs | 其他、文档 | docs: 变更追踪表登记登记提交 | - | - | 否 | 否 | - | - |
| 2026-08-03 20:59 | C-030 | 已完成 | [caaafe1](https://github.com/liwe123/Agent-Togterher/commit/caaafe1) | liwe123 | Docs | 其他 | Add GitHub Actions workflow for Python package with Conda | - | - | 否 | 否 | - | - |
| 2026-08-03 21:04 | C-031 | 已完成 | [1fd9aba](https://github.com/liwe123/Agent-Togterher/commit/1fd9aba) | LI | Docs | 其他、文档 | docs: 统一 PRD 文档命名为 PRD-前缀 | - | - | 否 | 否 | - | - |
| 2026-08-03 21:04 | C-032 | 已完成 | [42dcda5](https://github.com/liwe123/Agent-Togterher/commit/42dcda5) | LI | Docs | 其他、文档 | docs: 变更追踪表登记 PRD 重命名提交 | - | - | 否 | 否 | - | - |
| 2026-08-03 21:05 | C-033 | 已完成 | [9d4a57e](https://github.com/liwe123/Agent-Togterher/commit/9d4a57e) | LI | Docs | 其他、文档 | docs: 变更追踪表登记 CI workflow 与 PRD 重命名提交 | - | - | 否 | 否 | - | - |
| 2026-08-06 21:26 | C-034 | 已完成 | [b7f7d27](https://github.com/liwe123/Agent-Togterher/commit/b7f7d27) | LI | Docs | 其他 | 同步优化版项目为新的 Git 基线 | - | - | 否 | 否 | - | 将优化后的完整项目作为当前主线基线提交 |
| 2026-08-06 21:28 | C-035 | 已完成 | [29deb0e](https://github.com/liwe123/Agent-Togterher/commit/29deb0e) | LI | Docs | 其他 | 合并远端历史并保留当前优化版项目状态 | - | - | 否 | 否 | - | 采用 ours 策略合并远端历史后推送到 GitHub |
| 2026-08-06 21:34 | C-036 | 已完成 | [6cab7da](https://github.com/liwe123/Agent-Togterher/commit/6cab7da) | LI | Docs | 其他、文档 | 同步优化版项目后刷新变更追踪表 | 更新 PRD 与 Excel 变更追踪表 | 生成脚本重跑 | 否 | 否 | - | 将新基线提交一并纳入改动表 |
| 2026-08-06 21:37 | C-037 | 已完成 | [2d1e659](https://github.com/liwe123/Agent-Togterher/commit/2d1e659) | LI | Docs | 其他、文档 | docs: make change log entries Chinese for recent sync | - | - | 否 | 否 | - | - |
| 2026-08-06 21:46 | C-038 | 已完成 | [7039e2a](https://github.com/liwe123/Agent-Togterher/commit/7039e2a) | LI | Docs | 其他 | 修复 GitHub Actions Python 包工作流以运行后端测试 | - | backend/requirements-dev.txt；backend/tests；.github/workflows/python-package-conda.yml | 否 | 否 | backend/tests/test_health.py 通过 | 移除缺失的 environment.yml 依赖，改为 pip 安装并在 backend 目录执行 pytest |
| 2026-08-06 21:49 | C-039 | 已完成 | [0e0a15f](https://github.com/liwe123/Agent-Togterher/commit/0e0a15f) | LI | Docs | 其他、文档 | docs: record the GitHub Actions workflow fix in the change log | - | - | 否 | 否 | - | - |
| 2026-08-06 22:42 | C-040 | 已完成 | [c190d7d](https://github.com/liwe123/Agent-Togterher/commit/c190d7d) | LI | BUG | 后端、数据库、其他、文档 | fix: harden provider lookup and task recovery | - | backend/app/api；backend/app/core；backend/app/db；backend/app/models；backend/app/schemas；backend/app/services；backend/tests/test_api.py；backend/tests/test_task_recovery.py；backend/tests/test_tools.py | 是(task) | 是 | - | - |
| 2026-08-06 22:54 | C-041 | 已完成 | [c36bf54](https://github.com/liwe123/Agent-Togterher/commit/c36bf54) | LI | BUG | 后端 | fix: update database schema test for task lease fields | - | backend/tests/test_database.py | 否 | 否 | - | - |
| 2026-08-07 21:40 | C-042 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Requirement | 其他、前端 | Software Dock 增加可操作的连接状态详情 | software-dock.tsx：展示软件名称、接入位、在线状态；支持鼠标与键盘操作 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | PRD FR1；依赖同提交 |
| 2026-08-07 21:40 | C-043 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Requirement | 其他、前端 | Agent 消息支持安全 Markdown 结构化渲染 | message-bubble.tsx + react-markdown：标题、列表、行内代码、代码块、安全外链；跳过原始 HTML | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | PRD FR2；package.json/package-lock.json 新增 react-markdown |
| 2026-08-07 21:40 | C-044 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Requirement | 其他、前端 | 移动端聊天增加快捷指令与 Agent 选择面板 | chat-composer.tsx：移动快捷操作入口、模板列表、动态 Agent 列表 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | PRD FR3 |
| 2026-08-07 21:40 | C-045 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Requirement | 其他、前端 | Agent 详情弹层补齐完整交互能力 | agent-gallery.tsx：Dialog 语义、Escape/遮罩关闭、背景滚动锁定、焦点恢复 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | PRD FR4 |
| 2026-08-07 21:40 | C-046 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | BUG | 其他、前端 | 修复移动端浅色变量与根节点深色主题冲突 | globals.css：移除按屏幕宽度覆盖主题色与 color-scheme 的规则 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-047 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | BUG | 其他、前端 | 修复通讯录搜索后 Agent 服务分组错乱 | contacts-page.tsx：先按原始服务归属分组，再分别执行搜索过滤 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-048 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | BUG | 其他、前端 | 修复通讯录在线人数与连接状态不一致 | contacts-page.tsx：结合 WebSocket 连接状态与 Agent 状态计算在线人数 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-049 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | BUG | 其他、前端 | 修复聊天提及列表依赖固定中文姓名 | chat-composer.tsx：基于接口 Agent 数据和角色优先级生成提及列表 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-050 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | BUG | 其他、前端 | 修复客户端 mention 查询参数变化后输入框不更新 | chat-composer.tsx：监听查询参数并去重追加提及，保留用户已有输入 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-051 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Optimization | 其他、前端 | 设置页表单统一使用全局语义颜色 | settings-page.tsx：输入框改用 background/foreground/input/muted 设计令牌 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-052 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Optimization | 其他、前端 | Agent 卡片扩大为完整语义化交互区域 | agent-gallery.tsx：头像、姓名、状态和角色合并为可聚焦按钮 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-053 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Optimization | 其他、前端 | 完善通讯录搜索范围、无结果状态与清空操作 | contacts-page.tsx：支持姓名/角色/职责，Escape 清空，无结果提示与清空按钮 | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-054 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Optimization | 其他、前端 | 提升 Agent 角色辅助文字可读性 | agent-gallery.tsx：角色文字由 10px 调整为 11px | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 无需 PRD |
| 2026-08-07 21:40 | C-055 | 已完成 | [53268f4](https://github.com/liwe123/Agent-Togterher/commit/53268f4) | LI | Docs | 其他、前端 | 新增前端交互体验完善 PRD | docs/prd/PRD-前端交互体验完善.md | - | 否 | 否 | A/B 代码与视觉对比通过；375/桌面冒烟通过；lint + 28 tests + build 通过 | 登记 Requirement 的目标、用户故事、FR 与验收标准 |
| 2026-08-07 21:43 | C-056 | 已完成 | [39dae3c](https://github.com/liwe123/Agent-Togterher/commit/39dae3c) | LI | Docs | 其他、文档 | docs: register frontend experience changes | - | - | 否 | 否 | - | - |
| 2026-08-07 21:52 | C-057 | 已完成 | [6816c87](https://github.com/liwe123/Agent-Togterher/commit/6816c87) | LI | Docs | 其他、文档 | docs: itemize every frontend change in tracking table | - | - | 否 | 否 | - | - |
| 2026-08-07 22:20 | C-058 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | Requirement | 后端、其他、前端 | 新增可选 API Token 访问控制 | - | APP_API_TOKEN；REST 支持 Bearer/X-API-Key；WebSocket 支持请求头或 token 查询参数 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | PRD: docs/prd/PRD-后端访问控制与工作区隔离.md；FR1-FR3 |
| 2026-08-07 22:20 | C-059 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | Requirement | 后端、其他、前端 | Agent 工具继承可信工作区执行上下文 | - | Orchestrator 注入 workspace_id；query_tasks/get_agents 强制按当前工作区过滤并忽略模型伪造范围 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | PRD FR4 |
| 2026-08-07 22:20 | C-060 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | Requirement | 后端、其他、前端 | Provider Key 接口改为仅返回掩码元数据 | 设置页查看已保存凭证时仅显示掩码，并禁止将掩码作为新密钥保存 | ProviderKeyValue 返回 configured/masked_key/source，不再返回 api_key 原文 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | PRD FR5 |
| 2026-08-07 22:20 | C-061 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复客户端可伪造 Agent/System 消息 | - | 公开消息接口仅接受 user + normal，拒绝 sender_id、Agent、System 与其他消息类型 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-062 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复客户端可篡改任务执行状态与租约 | - | TaskCreate/TaskUpdate 移除 status/result/execution_token/expires_at 等服务端字段 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-063 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复工作区活跃任务配额漏算 Pending 任务 | - | MessageHub 配额统计改为 Pending + Running，达到上限返回 429 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-064 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复重启恢复任务绕过工作区并发额度 | - | recover_unfinished_tasks 按 Workspace 计算可用额度并限量调度 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-065 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复长任务固定租约过期后可能被重复执行 | - | Orchestrator 启动后台 lease heartbeat，按 execution_token 条件定期续租并在结束时取消 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-066 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复模型测试接口无法识别数据库自定义模型 | - | models/test 同时传入 DB API Keys 与 DB custom_models | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-067 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复模型列表忽略数据库 Provider Key 状态 | - | models 列表统一以 DB 优先、环境变量兜底判断 configured | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-068 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | BUG | 后端、其他、前端 | 修复删除仍被引用的自定义模型导致悬空配置 | - | 删除前检查 Agent.model_name 和其他模型 fallback_model，存在引用返回 409 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-069 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | Optimization | 后端、其他、前端 | 补充后端访问控制与工作区隔离回归测试 | - | 新增 API Token、消息伪造、任务字段保护、凭证脱敏、工具跨工作区隔离测试；更新既有 API 契约测试 | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 无需 PRD |
| 2026-08-07 22:20 | C-070 | 已完成 | [71ea26f](https://github.com/liwe123/Agent-Togterher/commit/71ea26f) | LI | Docs | 后端、其他、前端 | 新增后端访问控制与工作区隔离 PRD | - | docs/prd/PRD-后端访问控制与工作区隔离.md | 否 | 是（消息、任务更新、Provider Key GET 响应契约收紧） | A/B 代码对比通过；API 冒烟通过；56 tests + compileall + pip check 通过 | 覆盖目标、FR、非功能需求与验收标准 |
<!-- CHANGELOG:END -->

---

## PRD 文档索引

历史需求的详细 PRD（背景/目标/用户故事/FR/NFR/AC/里程碑）存放于 `docs/prd/`：

| PRD 文档 | 需求 | 关联提交 | 追踪表 |
|----------|------|----------|--------|
| [PRD-AgentConsoleMVP.md](prd/PRD-AgentConsoleMVP.md) | Agent Console MVP（多智能体协同运行台） | 599e268（+ca6322d、0a27d86） | 基线前 |
| [PRD-工具调用能力.md](prd/PRD-工具调用能力.md) | Agent 工具调用（Function Calling） | 36854c8 | C-025 |
| [PRD-APIKey管理.md](prd/PRD-APIKey管理.md) | 设置页 API Key 管理（DeepSeek 预设 + 任意厂商） | 19d4dca、abbb336 | C-006、C-015 |
| [PRD-自定义模型接入.md](prd/PRD-自定义模型接入.md) | 自定义模型接入（任意 provider/model + fallback 降级） | 48b3c47 | C-009 |
| [PRD-前端视觉与响应式优化.md](prd/PRD-前端视觉与响应式优化.md) | 前端视觉与响应式优化 + /contacts 通讯录页 | 9c2dd0e、0c46b78 | C-005、C-021 |
| [PRD-Windows一键启动脚本.md](prd/PRD-Windows一键启动脚本.md) | Windows 一键启动脚本 | fb94fb2 | C-007 |

---

## 后续维护约定

1. **每次改动完成并推送后**，运行 `python docs/generate_change_log.py` 重新生成
   本表与 Excel（自动从 git history 爬取，ID 按 `C-XXX` 递增）。
2. 自动推断的新行（类型按 commit 前缀、前后端/数据库按变更路径）较粗略；
   如需补充细节，在脚本 `CURATED` 字典按 commit sha 填写后重新运行。
3. 有数据库表新增/修改时，「是否有数据库」列填「是」并注明表名。
4. 改动类型限定 `Requirement` / `Optimization` / `BUG` / `Docs` 之一。
5. 重要技术决策（架构取舍）同步补充到 README 的「关键决策记录」。

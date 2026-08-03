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
| 改动时间 | ID | 改动类型 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 备注 |
|---|---|---|---|---|---|---|---|
| 2026-08-01 20:28 | C-001 | Optimization | 全站优化：消除前端 4 处重复 WebSocket 逻辑与死代码，统一连接/任务工具/常量，增加 ErrorBoundary；后端事件契约规范化、记录模型成本、限制并发 | 提取共用 useWorkspaceSocket；删除死代码(SystemStatus/SoftwareDock/selectConsoleAgents)；新增 ErrorBoundary；常量集中 constants.ts；任务工具去重 task-utils.ts；fetchedRef 防护 | TaskStepEventPayload Schema 替代手写 dict；LiteLLM 响应提取成本；并发控制(max 3, 429)；receipt 标注预留 | 否 | 前端测试 2→28；净减 237 行 |
| 2026-08-01 20:31 | C-002 | Docs | README 更新本轮优化详情 | README 章节补充 | - | 否 | 测试数 37/28 |
| 2026-08-01 20:33 | C-003 | Docs | README 全文中文化 | README 全量翻译 | - | 否 | 全量翻译 |
| 2026-08-01 20:37 | C-004 | Docs | README 风格重写，加入架构图与关键决策记录 | README 结构重排、徽章、ASCII 架构图 | - | 否 | 资深工程师口吻 |
| 2026-08-01 20:55 | C-005 | Requirement | 前端视觉与响应式优化，新增通讯录 /contacts 页面与 Agent 头像组件 | 新增 agent-portrait.tsx、contacts-page.tsx(/contacts 路由)；agent-gallery/status-panel/app-sidebar/chat 组件重构；globals.css 视觉令牌与响应式优化 | - | 否 | 1203 插入/471 删除，21 文件；位于独立主线(原 main)，当前分支强推覆盖 origin/main 后未合入 |
| 2026-08-01 21:17 | C-006 | Requirement | 新增「设置 → API Key 管理」：用户可在前端填入/删除各 Provider 密钥，存库优先于环境变量 | 设置页 API Key 管理 UI(密码框+眼睛+保存/删除)；use-settings 扩展 | ProviderCredential 模型；GET/PUT/DELETE /api/provider-keys；Key 解析优先级 DB>env | 是(provider_credentials) | Key 永不在列表回传 |
| 2026-08-01 21:20 | C-007 | Requirement | 新增 Windows 一键启动脚本 | start.bat / start.ps1 | - | 否 | Docker Compose 封装；自动复制 .env + 等健康 |
| 2026-08-02 12:22 | C-008 | BUG | 修复开发服务器端口无法访问（next.config standalone 配置与 dev 冲突） | output:standalone 改为 NEXT_BUILD_STANDALONE env 按需启用 | - | 否 | 仅生产 Docker 构建启用 |
| 2026-08-02 23:28 | C-009 | Requirement | 新增自定义模型接入（任意 provider/model + fallback 降级）；修复 API Key 眼睛图标切换失效 | 自定义模型添加/删除 UI +「自定义」徽章；眼睛图标切换修复(undefined 与 React 批处理冲突) | CustomModelConfig 模型；/api/custom-models；chat_completion 自定义解析；修按 name 查 PK bug | 是(custom_model_configs) | 后端 37→40 |
| 2026-08-02 23:33 | C-010 | Docs | README 补充「模型与密钥管理」章节，更新测试数 | README 章节补充 | - | 否 | 测试数 40/28 |
| 2026-08-02 23:36 | C-011 | BUG | 修复一键启动脚本中文乱码（UTF-8 被 cmd/PowerShell 按 ANSI 解析） | 脚本消息改纯 ASCII | - | 否 | 跨代码页安全 |
| 2026-08-03 13:06 | C-012 | BUG | 修复设置页自定义模型表单 / API Key 输入框黑底黑字无法阅读 | text-foreground 修复 | - | 否 | - |
| 2026-08-03 13:10 | C-013 | BUG | 设置页表单字段文字改纯白，提升可读性 | text-white / white/90 / 占位符 white/40 | - | 否 | - |
| 2026-08-03 13:37 | C-014 | BUG | 修复点击眼睛无法显示已保存 API Key（保存后清空 + Key 不回传，value 恒空） | 眼睛点击时拉取真实 Key 填充输入框再切换可见性 | 新增 GET /api/provider-keys/{provider} 按需返回 Key；get_api_key_value() | 否 | 显式操作才返回 Key，列表仍不回传 |
| 2026-08-03 13:50 | C-015 | Requirement | API Key 管理收敛为仅 DeepSeek 预设，用户可自行添加任意厂商的 API | 「添加厂商」表单(任意厂商名+Key)；厂商名 title-case；移除其余预设 | 移除 Provider 白名单；/models/providers/status 只显示 deepseek+DB 厂商 | 否(复用 provider_credentials) | 后端 40→42 |
| 2026-08-03 13:56 | C-016 | Docs | 新增 docs/PRD.md 变更追踪表 | 表格 + 维护约定 | - | 否 | 建立本表，后续改动由脚本实时生成 |
| 2026-08-03 13:59 | C-017 | Docs | 新增 Excel 变更追踪工作簿 | openpyxl 生成脚本 | - | 否 | 表结构含颜色/冻结/筛选 |
| 2026-08-03 14:01 | C-018 | Docs | 变更追踪表新增「改动内容」列，明确记录每次改了什么 | 表结构更新(PRD.md + Excel) | - | 否 | 业务描述与前后端技术分离 |
| 2026-08-03 14:04 | C-019 | Docs | 变更追踪表改为从 git history 自动生成 | generate_change_log.py（爬取 git log + 自动推断列 + CURATED 人工覆盖 + 生成 PRD/Excel） | - | 否 | 新提交自动生成行；已知提交按 sha 覆盖 |
<!-- CHANGELOG:END -->

---

## 后续维护约定

1. **每次改动完成并推送后**，运行 `python docs/generate_change_log.py` 重新生成
   本表与 Excel（自动从 git history 爬取，ID 按 `C-XXX` 递增）。
2. 自动推断的新行（类型按 commit 前缀、前后端/数据库按变更路径）较粗略；
   如需补充细节，在脚本 `CURATED` 字典按 commit sha 填写后重新运行。
3. 有数据库表新增/修改时，「是否有数据库」列填「是」并注明表名。
4. 改动类型限定 `Requirement` / `Optimization` / `BUG` / `Docs` 之一。
5. 重要技术决策（架构取舍）同步补充到 README 的「关键决策记录」。

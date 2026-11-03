# Agent Console 项目接力文档 (HANDOFF)

> 更新时间：2026-11-02  
> 工作目录：`E:\Agents`  
> 当前阶段：**Phase 5 UI 迁移第二批（DS-Bot 前端 UI/UX 设计迁移）已完成待推送**。最新基线：`docs/整改项目完整计划.md`（2026-11-01 批准，7 个批次 C-275~C-334）与 `docs/prd/PRD-DS-Bot前端设计系统与信息架构迁移.md`（2026-11-02）。已完成 C-267~C-274（群聊多 Agent 接力、独立验收、CI 假红修复）与 C-275~C-282（Batch1 执行级预算/脱敏/并发/认证 BUG/CI 锁定）；本批新增 DS-Bot 设计基座与信息架构迁移：4 主题 × 8 颜色键语义令牌层与弹簧动效、侧栏团队列、可拖拽详情面板、全局命令面板、聊天表面（分组气泡 / @ chip / typing / 动作卡 / Widget）、设置 198px 双栏 IA + 外观卡、用量页升级、DS-Bot 角色形状库；前端门禁 130 tests / typecheck / eslint / build 全绿，A/B 截图归档 `docs/ab-20261102/`。历史缺口已关闭：REQ-B1/B2/B7/B8/C1/C2 与 2026-09-25 P0 五项契约级缺陷。剩余开放项与批次归属见整改计划 §2.2（A1/A5/A6/A7、B3/B4/B5/B6/B9、D2/D3/D4/D6、E1-E3、P1/P2 遗留、DS-Bot P1-1/P1-3~P1-5）。**  
> 环境注意：GitHub 直连被阻断，推送须走本机代理 `git -c http.proxy=http://127.0.0.1:7890 push origin main`；本地门禁用 `pwsh -NoProfile -File scripts/ci-local.ps1`，CI 依赖由 `backend/constraints.txt` 锁定。

---

## 1. 架构演进与全景现状

系统已从最初的单体 MVP 成功演进为具备企业级多租户隔离、RBAC 细粒度权限、平台级操作审计、多维成本与 Token 治理、工作区配额与限流硬熔断、任务时序回放与断点单步调试、插件注册中心与工具热插拔、工作流模板引擎与 DAG 编排、持久化任务队列、独立 Worker 进程与分布式事件总线的全功能多智能体协同任务平台：

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 16 前端控制台                     │
│  - / (集群总览)           - /chats (多智能体群聊协作)        │
│  - /tasks (任务队列)      - /tasks/[id] (时序回放与断点调试)  │
│  - /workflows (工作流引擎) - /contacts (智能体通讯录)        │
│  - /settings (设置中心 - 5 大管理卡片响应式网格导航)         │
│  - /settings/members (成员与权限管理台 - 角色升降/邀请/移除) │
│  - /settings/audit (平台操作审计日志台 - 多维过滤/明细抽屉) │
│  - /settings/cost (成本中心与 Token 大屏 - 趋势/模型/Top榜)  │
│  - /settings/quota (工作区配额与限流大屏 - 水位指示/硬熔断)  │
│  - /settings/plugins (插件注册中心 - Manifest 检查/热插拔)   │
│  - /login (登录)          - /register (注册)                │
│  - TaskReplayPlayer (时间轴拖拽 / 1x-5x 倍速 / 断点恢复执行) │
│  - AppSidebar 工作区切换器 (多租户无缝切换 / 创建 / 邀请加入)│
│  - AuthGuard 路由守卫     - Bearer Token 401 自动无感续期     │
└───────────────┬─────────────────────────────┬───────────────┘
                │ REST API (Bearer JWT)       │ WebSocket (?token=JWT)
                ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 核心服务集群                     │
│  - app/api/v1/endpoints (auth, members, audit, cost, quota, │
│                         replay, plugins, workflows...)      │
│  - app/services/quota_service.py (配额计算与超额熔断服务)    │
│  - app/services/audit_service.py (全局异步审计埋点服务)      │
│  - app/core/permissions.py (RBAC 角色权限矩阵与拦截依赖)     │
│  - app/core/auth.py (PBKDF2-SHA256 密码哈希 / PyJWT 签发)    │
│  - app/core/security.py (API Token 与 JWT 双轨鉴权)         │
│  - app/core/message_hub.py (@Agent 提及解析与任务生成)       │
│  - app/core/orchestrator.py (多阶段 Agent 编排流水线)        │
│  - app/services/task_service.py (任务状态机与租约管理)       │
│  - app/services/task_lease.py (任务级执行租约唯一实现)       │
│  - app/services/tools.py (Function Calling 安全工具集)       │
│  - app/services/webhook.py (插件 Webhook 签名执行器与出站通知)│
│  - app/services/dag_engine.py (DAG 工作流分层并行引擎)       │
│  - app/core/worker_registry.py (Worker 心跳注册与分布式锁)   │
│  - app/api/v1/endpoints/tasks.py (任务队列 + HITL approve/reject)│
│  - app/websocket/distributed.py (Redis Pub/Sub 跨进程总线)   │
└───────────────┬─────────────────────────────┬───────────────┘
                │ AsyncSession                │ 队列轮询 / 原子 Claim
                ▼                             ▼
┌───────────────────────────────┐ ┌───────────────────────────┐
│     SQLAlchemy 数据持久层     │ │    独立 Worker 消费进程   │
│  - 21 张领域数据表            │ │  - app/worker.py          │
│  - PostgreSQL (Alembic 治理)  │ │  - worker_concurrency 控制 │
│  - 默认工作区与 6 个预设 Agent │ │  - 租约心跳与死信重试      │
└───────────────────────────────┘ └───────────────────────────┘
```

---

## 2. 数据库表清单 (共 21 张)

| 表名 | 模块 | 核心作用 |
|---|---|---|
| `users` | 认证 | 用户账号 (`email`, `password_hash`, `display_name`, `avatar`, `is_active`, `last_login_at`) |
| `workspaces` | 租户 | 工作区与租户容器 |
| `workspace_memberships` | 权限 | 用户与工作区成员映射及角色 (`owner`, `admin`, `member`, `viewer`) |
| `workspace_invitations` | 邀请 | 工作区专属邀请码与核销状态 (`invite_code`, `role`, `expires_at`, `status`) |
| `audit_logs` | 审计 | 平台操作审计流水 (`action`, `resource_type`, `resource_id`, `detail`, `ip_address`) |
| `quota_configs` | 配额 | 工作区配额与限流规则 (`monthly_budget_usd`, `max_monthly_tokens`, `max_concurrent_tasks`, `is_hard_limit`) |
| `plugins` | 插件 | 插件元数据与 Manifest 定义 (`name`, `manifest_json`, `is_public`, `version`) |
| `workspace_plugins` | 插件 | 工作区挂载与凭证配置 (`workspace_id`, `plugin_id`, `is_enabled`, `config_json`) |
| `workflow_templates` (✨ 新增) | 工作流 | 工作流模板与 DAG 节点 (`workspace_id`, `name`, `nodes_json`, `variables_json`, `is_system`) |
| `workflow_runs` (✨ C-186 新增) | 工作流 | 工作流运行记录与节点快照 (`template_id`, `task_id`, `status`, `snapshot_nodes_json`) |
| `agents` | 智能体 | 预设与自定义 Agent (`role`, `model_name`, `system_prompt`, `status`) |
| `conversations` | 聊天 | 会话容器 |
| `messages` | 消息 | 聊天消息事实记录 |
| `tasks` | 任务 | 业务任务事实源 (`status`, `result`, `execution_token`, `execution_token_expires_at`) |
| `task_steps` | 步骤 | 任务各执行阶段输入、输出与耗时 |
| `task_queue_items` | 队列 | 任务持久化调度队列 (`status`: queued/leased/completed/dead, `attempt_count`) |
| `model_calls` | 审计 | LLM 调用统计 (`prompt_tokens`, `completion_tokens`, `cost`, `latency_ms`) |
| `provider_credentials` | 密钥 | 模型厂商 API Key 存储（掩码管理） |
| `custom_model_configs` | 模型 | 自定义模型与 Fallback 容灾映射 |
| `integration_nodes` | 外部接入 | 外部 Agent 集成节点注册（Cursor / Codex 桥接） |
| `refresh_tokens` (✨ 新增) | 认证 | 服务端 refresh token 记录与吊销 (`jti`, `expires_at`, `revoked_at`) |

---

## 3. Phase 4 全批次达成记录

| 批次 | 任务项 | 对应 PRD | 工单 ID | Commit SHA | QA 验收 |
|---|---|---|---|---|---|
| **Batch 1** | A1: 用户认证系统 (JWT / User 表 / Auth 页面) | `docs/prd/PRD-用户认证系统.md` | C-101 | `9337826` / `702942c` | ✅ APPROVED |
| **Batch 2** | A2: RBAC 角色权限 + A3: 多租户隔离 | `docs/prd/PRD-角色权限与多租户隔离.md` | C-103 | `ad18c19` / `22208c7` | ✅ APPROVED |
| **Batch 3** | B1: 平台级审计日志 + C1: 成本统计面板 | `docs/prd/PRD-平台级审计日志.md`<br>`docs/prd/PRD-成本统计面板.md` | C-105<br>C-106 | `1ca7aec` / `6019883` | ✅ APPROVED |
| **Batch 4** | B2: 任务回放与断点调试 + C2: 配额与限流治理 | `docs/prd/PRD-任务执行回放与单步调试.md`<br>`docs/prd/PRD-工作区配额与限流治理.md` | C-108<br>C-109 | `a4c0c1f` / `31ed948` | ✅ APPROVED |
| **Batch 5** | D1: 插件注册中心 (Manifest / 热插拔) | `docs/prd/PRD-插件注册中心.md` | C-110 | `037e968` / `9dbc783` | ✅ APPROVED |
| **Batch 6** | D2: 工作流模板引擎 (DAG 节点 / 一键实例化) | `docs/prd/PRD-工作流模板引擎.md` | C-111 | `19d4bdc` / `370021e` | ✅ APPROVED |

---

## 3.5 Phase 1 增量（C-183~C-187，2026-09-04 推送 94343a2）

| 工单 | 能力 | 类型 | 核心落地 |
|---|---|---|---|
| C-183 | 插件 Webhook 执行器与出站通知 | Requirement | `services/webhook.py` HMAC-SHA256 签名执行器 + 终态 fan-out；main/worker 双进程装载 |
| C-185 | HITL 人工审批节点 | Requirement | `dag_engine.py` human_approval 挂起分支 + `tasks.py` approve/reject 端点 + 前端审批按钮 |
| C-186 | DAG 工作流引擎 | Requirement | `services/dag_engine.py` 分层并行执行 + `workflow_runs` 表 + 节点快照 |
| C-184 | 测试环境修复 | BUG | conftest DATABASE_URL 钉一次性 SQLite；C-190 修 CI 挂 |

> 三项均已完成守则流程（PRD 三处同步 + 测试 + 验收 + 推送）。前端缺口登记在 20260907 报告 C1/C2/B1：C1（Webhook 配置 UI）已由 C-217 落地、C2（HITL 按钮角色控制）已由 C-214 落地，仅剩 B1（DAG 线性渲染）留 Phase 3 收尾。

## 3.6 Phase 5 UI 迁移第二批（DS-Bot 前端 UI/UX 迁移，2026-11-02）

- **PRD**：`docs/prd/PRD-DS-Bot前端设计系统与信息架构迁移.md`（Target/用户故事/FR1-FR12/AC1-AC12；已登记 `docs/PRD.md` 索引，PRD.html 由生成脚本重建）。
- **落地范围**（Lead + 3 个子 Agent 并行，按 `docs/DS-Bot分析报告/DS-Bot前端UI与交互模式分析.md` §5 可迁移清单）：

| 主题 | 关键落点 |
|---|---|
| 设计基座（FR1-FR3） | `globals.css` 4 主题 × 8 颜色键 → `--console-*` 语义令牌 + Tailwind 映射（`bg-console-*`/`text-console-*`/`border-console-*`/`rounded-console-*`）+ `.console-*` 工具类；`lib/design-tokens.ts`（主题/强调色 19 ink/WCAG accentInk/暗色映射）；`lib/motion.ts`（DS-Bot springEasing 同算法生成 25 点 `linear()`，8 条曲线）；`hooks/use-appearance.ts`（localStorage 持久化 + `data-theme`/`data-motion`/dark class）；三档动效 quiet/normal/lively + reduced-motion 全量降级 |
| 信息架构（FR4-FR6） | `console/app-sidebar.tsx` rail 76px + `console/team-column.tsx` 团队列 264px（主 Agent 磁贴/状态点/活预览/骨架）；`console/details-panel.tsx` 320–520px 可拖拽面板（localStorage 持久化 + 详情/统计 tab）；`console/command-palette.tsx` Ctrl/Cmd+K 三组命令（`components/app-providers.tsx` 挂载）；`hooks/use-team-roster.ts` |
| 聊天表面（FR7-FR9） | `chat/message-bubble.tsx`（分组圆角 18/6 + 0.5px 内描边 + hover 工具条 + 事件行 + @ chip）、`chat/message-list.tsx`（30min 时间分隔/空态/骨架/typing 行）、`chat/chat-page.tsx`（40px 胶囊头 + 渐变遮罩 + 成员条 + 详情面板）、`chat/action-card.tsx`（waiting_approval 审批 A/B/C 键位 + 单卡仲裁 + 真实 approve/reject）、`chat/widget-card.tsx`（Metric/DataTable/Progress/Callout）、`lib/action-cards.ts` 放置去重 |
| 设置与用量（FR10-FR11） | `settings/settings-page.tsx` 198px 粘性分页导航 + 区块行 + 外观区块；`settings/appearance-card.tsx`（主题/明暗/强调色/动效档位）；`app/settings/cost/page.tsx`（24h/7d/30d/12m + 堆叠柱 + 排行 + 空态，12m 标注服务端 90 天上限） |
| 角色形象与反馈（FR12） | `lib/bot-shapes.ts`（从 DS-Bot CHARACTERS 提取 whale/star/moon/gumdrop/squircle）+ `console/bot-mark.tsx`（SVG + paints 高光 + 视线跟随 + running/waiting/alert 动效）+ `ui/feedback.tsx`（EmptyState/SkeletonRows/ShimmerText/InlineError）；移动端底栏 6 列修复 |
| 页面外壳 | 12 个页面文件外框改 `md:grid-cols-[auto_minmax(0,1fr)]` + `overflow-x-clip`（保持侧栏 sticky），任务/通讯录/工作流/设置子页同步换肤 |

- **验证**：`npm test` 130 passed（新增 design-tokens 9 / motion 5 / mention-utils +12 / action-cards 14 / bot-shapes 9）；`npx tsc --noEmit` 0；`npx eslint` 0；`next build` static pages 16/16、Route 表 15 条全部成功。
- **CI 证据**：GitHub Actions run 41459009214（workflow「Python Package Tests」#99，head 860f06c）：build-linux / test-postgres / test-frontend 三 job success，dependency-canary 按 push 触发规则 skipped（仅 schedule/workflow_dispatch 运行，规则未变）。
- **A/B 取证**：`docs/ab-20261102/`（HEAD `255cd29` worktree 生产构建 vs 本次生产构建；1440×900 / 390×844；deepseek 深色 + paper 浅色 / mono / moonlight；含命令面板、详情面板、设置外观、用量页），结论见该目录 `README.md`。
- **留待后续**：记忆面板（依赖 Phase 2 记忆能力）、relay 暂停/继续（缺后端暂停语义）、自定义 emoji 头像与 BotMark 共存、HITL 卡片的服务端备注字段。

## 3.7 Phase 5 UI 迁移第三批（DS-Bot 图标设计体系迁移，2026-11-02）

- **PRD**：`docs/prd/PRD-DS-Bot图标设计体系迁移.md`（目标/用户故事/FR1-FR5/AC1-AC6；已登记 `docs/PRD.md` 索引）。对应改动表：C-287（feat）/ C-288（docs 登记）。
- **落地**：把全站 lucide-react 图标与 emoji 图标（95 语义 / 239 处 / 33 文件）完整迁移为 DS-Bot 自绘图标体系：
  - `frontend/src/lib/icon-paths.ts`：89 个图标纯数据注册表（20×20 网格、1.5/1.6/1.8 线宽、圆头圆角、currentColor、7 个填充、1 个虚线；28 个路径与 DS-Bot `client.js` 逐字一致）。
  - `frontend/src/components/ui/icons.tsx`：`<Icon name/>` 渲染器 + 95 个历史语义同名导出（替换只改 import 路径）+ 扩展 `Plug`；图标颜色全部继承 `--console-*`。
  - `components/console/agent-glyph.tsx`：聊天成员条/成员面板/提及候选/快捷 @ 芯片/任务负责人头像统一为角色形状或 Plug 图标，emoji 头像渲染归零。
  - `lucide-react` 依赖移除；`✕` 文本关闭按钮与 `🤖` emoji 图标清零；`icons.test.mjs` 强制校验注册表网格/线宽/颜色、95 具名导出、0 lucide 引用、0 emoji 残留。
- **验证**：前端 141 tests passed（新增 11）/ typecheck 0 / eslint 0 / next build 16 路由成功；独立视觉 QA PASS（0 阻塞，12 条非阻塞已整改 10 条，证据 `.tmp/qa-icons/` 不入库）；A/B 截图归档 `docs/ab-20261102-icons/`（22 张，含全图标预览大图与明暗主题）。
- **CI 复验记录**：首次推送 run 41580212960（head 426530a）中 build-linux / test-frontend success、dependency-canary skipped，test-postgres 失败（本批无后端代码改动，疑似环境/日期边界，已触发重跑复验并在此回写最终结果）。
- **独立验收**：独立子 Agent 两轮验收——首轮 FAIL（PRD.html 与文档源 2 行失同步 B1）→ 修复后复验 **PASS**（8/8 必查项通过、0 阻塞；保留 1 条范围口径观察）；验收报告见 task-8。
- **留待后续**：quota 页个别硬编码 amber 色在 paper 主题下偏弱（非本批引入）、自定义 emoji 头像与角色形状共存方案、blocks 与 layout-dashboard 进一步区分。

## 4. 质量与验证基准

- **后端自动化测试**：44 个测试模块，共计 **270 tests passed**（100% 通过；测试用一次性 SQLite 文件库跑测，CI 另有 `test-postgres` job 覆盖 PG 方言，生产 PostgreSQL 由 `test_alembic_migrations.py` 保障迁移正确性；2026-08-29 compose 容器实跑 AC1/AC2/AC4/AC7/AC8 通过；2026-09-26 本机复跑 270 passed / PG 复跑 270 passed）。
- **CI 稳定性修复（2026-09-26）**：`test-postgres` 跨事件循环 Redis 客户端（配额限流单例）改为随循环重建；`build-linux` aiosqlite 取消期关闭竞争（WS 会话取消中断 DB 操作 → invalidate → terminate 双 stop 挂死）通过「WS 快照与会话释放前移到握手 accept 之前」根除；CI 增加 job `timeout-minutes`、pytest-timeout、无进展看门狗（dump 线程栈 + asyncio 任务栈）与 `-s` 诊断。修复后连续 3 次复跑三 job 全绿。
- **前端质量门禁**：`eslint` 0 error 0 warning，`node --test` **141 passed**（2026-11-02；新增 design-tokens/motion/mention-utils/action-cards/bot-shapes/icons 用例），`next build` static pages 16/16、Route 表 15 条全部编译成功；UI 改动 A/B 与冒烟记录见 `docs/ab-20261102/` 与 `docs/ab-20261102-icons/`。
- **文档自动化体系**：14 列变更记录全量无空值，`PRD.md`、`Agent_Console_变更追踪.xlsx` 与 `PRD.html` 自动化生成并与 Git 历史完全同步。

---

## 5. 常用运行命令

### 启动后端
```powershell
cd E:\Agents\backend
uvicorn app.main:app --reload --port 8000
```

### 启动 Worker 进程
```powershell
cd E:\Agents\backend
python app/worker.py
```

### 启动前端控制台
```powershell
cd E:\Agents\frontend
npm run dev
```

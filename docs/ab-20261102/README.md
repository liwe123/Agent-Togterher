# DS-Bot UI/UX 迁移二期 · A/B 记录（2026-11-02）

> 目的：为《PRD-DS-Bot前端设计系统与信息架构迁移》提供合并前后视觉对照与冒烟取证。
> 结论须与《Agent_Console_变更追踪.xlsx》对应行「验证结果 / 备注」保持一致。

## 1. 环境与口径

| 项 | baseline（改动前） | new（改动后） |
|---|---|---|
| 前端来源 | HEAD `255cd29` 的 git worktree（`git worktree add --detach .tmp/baseline-wt HEAD`），按仓库现状零改动 | 本次工作树（UI 迁移全部改动） |
| 构建方式 | `next build --webpack` + `next start -p 3100` | `next build`（Turbopack）+ `next start -p 3000` |
| 后端 | 同一本地 FastAPI（`uvicorn app.main:app --port 8000`，SQLite 开发库 + 默认种子数据） | 同左 |
| 登录态 | 演示账号 `demo2@agent-console.local`（admin）经 API 登录后写入 localStorage token | 同左 |
| 视口 | 桌面 1440×900（dpr1）；移动 390×844（mobile，dpr2） | 同左 |
| 主题 | deepseek 深色（默认） | deepseek 深色（默认）+ paper 浅色 / mono / moonlight 取证 |
| 截图工具 | 本地 Chrome headless + CDP 脚本（`.tmp/tools/shoot.mjs`，只读工具，不入库） | 同左 |

> 说明：dev 模式（`next dev`）下 React StrictMode 会重复执行 effect，基线代码的 `fetchedRef` 守卫会使数据停在加载态；因此两边均采用**生产构建**取证，与真实部署一致。

## 2. 截图清单

| 文件 | 视口 | 场景 |
|---|---|---|
| `baseline-console-1440.png` / `new-console-1440.png` | 1440×900 | 控制台总览（会话首页） |
| `new-console-panel-1440.png` | 1440×900 | 控制台 + 右侧 Agent 详情面板（点击团队列成员） |
| `new-command-palette-1440.png` | 1440×900 | 全局命令面板（Ctrl+K 打开） |
| `baseline-chats-1440.png` / `new-chats-1440.png` | 1440×900 | 群聊（消息分组 / 接力链 / @ chip / typing） |
| `new-chats-member-panel-1440.png` | 1440×900 | 群聊 + Agent 详情面板 |
| `baseline-settings-1440.png` / `new-settings-1440.png` | 1440×900 | 设置中心（双栏 IA） |
| `new-settings-appearance-1440.png` | 1440×900 | 设置 · 外观（主题/模式/强调色/动效档位） |
| `baseline-cost-1440.png` / `new-cost-1440.png` | 1440×900 | 用量页（范围/堆叠柱/排行/空态） |
| `new-settings-light-1440.png`、`new-console-light-paper-1440.png` | 1440×900 | paper 浅色模式 |
| `new-console-mono-1440.png`、`new-console-moonlight-1440.png` | 1440×900 | mono / moonlight 主题 |
| `baseline-console-390.png` / `new-console-390.png` | 390×844 | 移动端控制台（底栏导航） |
| `baseline-chats-390.png` / `new-chats-390.png` | 390×844 | 移动端群聊 |
| `new-settings-390.png` | 390×844 | 移动端设置 |

## 3. 对照结论

1. **设计基座**：baseline 为 M3 大圆角 + 阴影的深色卡片；new 改为 DS-Bot 的「4 主题 × 8 颜色键 → `--console-*` 语义令牌 → 既有 M3 token 重映射」，以 0.5–1px 发丝线与内描边承担层级，配三级文字、两级线、中性 hover/active 叠加；未逐个改造的页面（任务 / 通讯录 / 工作流 / 设置子页）因 M3 token 重映射同步换肤，浅色模式与新主题下无死白/死黑残留。
2. **信息架构**：侧栏由 76px rail 扩为「76px rail + 264px 团队列」（主 Agent 磁贴 / 状态点 / 活预览 / 骨架与错误兜底）；控制台在 xl+ 常驻可拖拽详情面板（320–520px、localStorage 持久化）；新增全局命令面板（页面 / Agent / 操作三组）；设置页改为 198px 粘性分页导航 + 内容区；用量页升级范围 tabs（24h/7d/30d/12m）+ 堆叠柱 + 排行 + 空态。
3. **聊天表面**：居中 40px 胶囊头 + 60px 渐变遮罩；消息按发言人分组（22px 头像 + 名字 + 11px tabular 时间）、气泡 18px 圆角且分组首尾收窄 6px、0.5px 发丝内描边替代阴影、hover 工具条（复制/跳任务）；>30min 时间分隔；typing 行（头像 + shimmer + 计时）；@ 提及渲染为带形状头像的行内 chip（用户气泡内使用继承色，8 主题实测对比度 5.6–19.8:1，修复前 1.0–2.25:1）；动作卡（waiting_approval 审批，A/B/C 键位 + 单卡仲裁）。
4. **角色形象**：以 DS-Bot 手绘形状库（whale/star/moon/gumdrop/squircle）替换 emoji 头像，running/waiting/alert 三态动效 + `prefers-reduced-motion` / quiet 降级；emoji 头像共存方案留待后续批次。
5. **移动端**：底栏 6 项由 `grid-cols-5` 换行修成 6 列单行（baseline 亦存在换行，属既有缺陷一并修复）；390×844 无横向滚动。
6. **未覆盖/留待后续**：DS-Bot 记忆面板（依赖 Phase 2 记忆能力）、relay 暂停/继续（无后端暂停语义）、设置对话框级三档动效预览动画、自定义头像与 BotMark 共存。

## 4. 复现命令

```powershell
# 后端（开发库）
cd E:\Agents\backend
$env:EVENT_BUS_ENABLED='false'; $env:DISTRIBUTED_LOCK_ENABLED='false'
E:\Agents\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 新实现（生产构建）
cd E:\Agents\frontend
npm run build
npx next start --port 3000

# 基线（HEAD worktree，仅本机取证用）
git worktree add --detach E:\Agents\.tmp\baseline-wt HEAD
cmd /c mklink /J E:\Agents\.tmp\baseline-wt\frontend\node_modules E:\Agents\frontend\node_modules
cd E:\Agents\.tmp\baseline-wt\frontend
npm run build -- --webpack   # Turbopack 不接受跨根 node_modules 软链
npx next start --port 3100

# 截图（本地 Chrome headless；脚本在 .tmp/tools/shoot.mjs，不入库）
node .tmp\tools\shoot.mjs --plan .tmp\tools\plan-baseline.json --out-dir docs\ab-20261102
node .tmp\tools\shoot.mjs --plan .tmp\tools\plan-final-all.json --out-dir docs\ab-20261102
```

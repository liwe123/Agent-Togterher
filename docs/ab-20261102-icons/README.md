# DS-Bot 图标设计体系迁移 · A/B 记录（2026-11-02）

> 目的：为《PRD-DS-Bot图标设计体系迁移》提供「迁移前 lucide/emoji 混排」与「迁移后 DS-Bot 自绘图标体系」的视觉对照与冒烟取证。
> 结论须与《Agent_Console_变更追踪.xlsx》对应行「验证结果 / 备注」保持一致。

## 1. 环境与口径

| 项 | baseline（改动前） | new（改动后） |
|---|---|---|
| 前端来源 | HEAD `00af490` 的生产构建（lucide-react 95 个语义图标 239 处 + ✕/🤖 emoji） | 本次工作树（icon-paths 注册表 + icons 渲染器 + 全量替换） |
| 构建方式 | `npm run build`（Turbopack）+ `next start -p 3000` | 同左 |
| 后端 | 同一本地 FastAPI（SQLite 开发库 + 默认种子数据，`uvicorn --port 8000`） | 同左 |
| 登录态 | 演示账号 `demo2@agent-console.local`（admin）经 API 登录后写入 localStorage token | 同左 |
| 视口 | 桌面 1440×900（dpr1）；移动 390×844（mobile，dpr2） | 同左 |
| 截图工具 | 本地 Chrome headless + CDP 脚本（`.tmp/tools/shoot.mjs`，只读工具，不入库） | 同左 |

## 2. 截图清单

| 文件 | 视口 | 场景 |
|---|---|---|
| `preview-icons-1440.png` | 1440×2312（整页） | 图标预览页：尺寸阶梯 / 颜色继承 / 89 个图标全量 / 95 个历史语义映射（另含扩展插件图标 Plug）；本目录共 25 个 PNG（baseline 10 + new 14 + 全图标预览 1） |
| `baseline-console-1440.png` / `new-console-1440.png` | 1440×900 | 控制台（导航 rail / 软件 Dock / 团队列 / 详情面板空态） |
| `baseline-console-panel-1440.png` / `new-console-panel-1440.png` | 1440×900 | 控制台 + 右侧 Agent 详情面板 |
| `baseline-chats-1440.png` / `new-chats-1440.png` | 1440×900 | 群聊（胶囊头 / 消息工具条 / 输入区发送键 / 键盘提示） |
| `new-chats-panel-1440.png` | 1440×900 | 群聊 + Agent 详情面板（成员条 / 详情 / 成员形状头像） |
| `new-chats-390.png` | 390×844 | 移动端群聊（输入区 / 提及 / 发送图标） |
| `new-console-light-paper-1440.png`、`new-settings-light-paper-1440.png` | 1440×900 | paper 浅色主题（currentColor 图标适配） |
| `baseline-settings-1440.png` / `new-settings-1440.png` | 1440×900 | 设置中心（分页导航图标 / 区块行图标） |
| `baseline-cost-1440.png` / `new-cost-1440.png` | 1440×900 | 用量页（范围 tabs / KPI 卡图标 / 排行） |
| `baseline-tasks-1440.png` / `new-tasks-1440.png` | 1440×900 | 任务队列（状态筛选图标 / 列表） |
| `baseline-workflows-1440.png` / `new-workflows-1440.png` | 1440×900 | 工作流模板引擎（标题 / 刷新 / 新建 / 运行 / 节点箭头） |
| `baseline-contacts-1440.png` / `new-contacts-1440.png` | 1440×900 | 通讯录 |
| `baseline-console-390.png` / `new-console-390.png` | 390×844 | 移动端控制台（底部导航 6 图标） |
| `baseline-command-palette-1440.png` / `new-command-palette-1440.png` | 1440×900 | 全局命令面板（页面/Agent/操作分组图标） |

## 3. 对照结论

1. **图标语言统一**：改动前为 lucide-react 线性图标（24 网格、2px 线宽、无填充）与 emoji（✕ 关闭、🤖 头像）混排；改动后全部替换为 20×20 网格、1.5/1.6/1.8 线宽、圆头圆角、currentColor 的 DS-Bot 自绘图标，89 个图标覆盖 95 个历史语义名（另含扩展 Plug 图标）（同义合并：AlertCircle/CircleAlert、Clock/Clock3、Users/UsersRound/ContactRound、Loader2/LoaderCircle、MessageCircleMore/MessagesSquare、TriangleAlert/AlertTriangle 等）。
2. **头像图形统一**：聊天成员条/成员面板/提及候选/快捷 @ 芯片/任务负责人头像等原 emoji 头像统一替换为 DS-Bot 角色形状（AgentGlyph），外部集成节点用 Plug 线性图标，emoji 图标在 src 中归零。
3. **依赖归零**：lucide-react 已从 package.json/lockfile 移除，src 下无任何 lucide 引用；新增 `icons.test.mjs` 对注册表（数量/网格/线宽/颜色/路径）、具名导出覆盖、依赖与 emoji 残留做强制校验。
4. **视觉一致**：导航 rail（布局/群聊/通讯录/任务/工作流/设置）、软件 Dock（cursor/codex/trae/antigravity 语义）、设置分页与区块行、任务状态筛选、工作流运行/新建、聊天发送与工具条图标均使用同一套笔触；填充仅用于播放/暂停/月亮/单选点等少量场景。
5. **颜色继承**：图标全部 currentColor，随 `text-console-*` 令牌在深色/浅色主题下自动适配；无硬编码色值（单测强制）。
6. **布局无回归**：调用方原有 Tailwind 尺寸类保留（size-3/3.5/4/5/6 等），图标 width/height 属性兜底；A/B 截图对比无尺寸跳变或错位。
7. **保留项**：DAG 画布（数据可视化 SVG）与角色形象库（bot-mark/bot-shapes）不属于界面图标，保持现状；命令面板快捷键符号（↑↓/⏎/⌘）为键盘提示文本，按 DS-Bot 用法保留。

## 3.1 独立视觉 QA 结论（2026-11-02）

- 结论：**通过（0 阻塞）**。审查快照冻结 `icon-paths.ts`（89 图标）与 `icons.tsx`（95 历史导出 + Plug 扩展）。
- 设计语言达标：20×20、currentColor、圆头圆角；线宽 1.5×69 / 1.6×16 / 1.8×2（另 2 个沿用默认 1.6）；填充仅 7 个图标；注册表无硬编码色值；28/89 图标路径与 DS-Bot `client.js` 逐字一致。
- 应用层一致：95 语义名同名导出；导航↔命令面板↔设置↔任务↔聊天映射一致；253 处 JSX 用法均显式尺寸；25 处 Loader 均带 `animate-spin`；头像图形统一为角色形状/Plug（emoji 头像渲染归零）。
- 明暗主题：深色与 paper 浅色下 12/16/20/24/32px 均清晰无裁切；A/B 布局零位移（像素差 0.24%–0.34%）。
- 非阻塞问题已整改：wrench 越界、server-cog 拥挤、key 右偏、gauge 偏小、sparkles/palette/calendar-clock 轻微越界、flame 偏小偏高、cursor-click 噪点、blocks 与 layout-dashboard 区分度（已改 3 块拼合）。
- 留待后续（非本批）：quota 页个别硬编码 amber 色在 paper 主题下对比偏弱（非本批引入）。

## 4. 复现命令

```powershell
# 后端（开发库）
cd E:\Agents\backend
$env:EVENT_BUS_ENABLED='false'; $env:DISTRIBUTED_LOCK_ENABLED='false'
E:\Agents\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 前端（生产构建）
cd E:\Agents\frontend
npm run build
npx next start --port 3000

# 截图（本地 Chrome headless；脚本在 .tmp/tools/shoot.mjs，不入库）
node .tmp\tools\shoot.mjs --plan .tmp\tools\plan-icon-baseline.json --out-dir docs\ab-20261102-icons
node .tmp\tools\shoot.mjs --plan .tmp\tools\plan-icons-new.json --out-dir docs\ab-20261102-icons
```

> 说明：图标预览页 `/icon-preview` 为临时路由，仅用于本地截图；截图归档后已从源码删除，不进入产品构建。

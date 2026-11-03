# PRD · DS-Bot 图标设计体系迁移（图标全量替换）

> 类型：Requirement｜状态：已实施并验收（2026-11-02）｜日期：2026-11-02｜作者：LI
> 依据：docs/DS-Bot分析报告/DS-Bot前端UI与交互模式分析.md §1（设计系统）、docs/DS-Bot对标分析与改造方案.md §3；DS-Bot 源码包 .tmp/dsbot/package/client.js（npm @lininn/ds-bot@0.2.6）中的 src/client/icons.js（约 L3751-3868）、secret-card.js（L6406-6423）、browser 工具条（L17037-17054）、widgets（L5427）、feedback.js（L15143）等图标定义。
> 前置：docs/prd/PRD-DS-Bot前端设计系统与信息架构迁移.md（C-283~C-285，令牌/信息架构/角色形象已完成，本批补齐「图标」这一最后的视觉资产层）
> 关联：docs/Agent任务守则.md（Requirement：PRD 三处同步 + A/B + 独立验收 + 改动表 + 推送）

---

## 1. 目标

把 Agent Console 当前混用 **lucide-react 线性图标（95 个语义、239 处使用）＋ emoji 图标（✕/🤖）** 的图标体系，完整迁移为 DS-Bot 的自绘图标设计体系：

1. **统一画布与笔触**：所有图标绘制在 **20×20 viewBox** 网格内，内容区留 2.5–3px 内边距；圆头圆角（stroke-linecap/linejoin: round）；线宽 1.5（常规线性）/1.6（导航与主要动作）/1.8（发送、小尺寸链接）；stroke: currentColor，默认 fill: none；仅星标、播放/暂停、月亮、单选点等少量图标使用填充。
2. **统一尺寸阶梯**：按场景使用 12/14/15/16/18px（默认 16；导航与主要按钮 16–18；行内元信息 12–14），由调用方 className 的 Tailwind 尺寸控制，图标组件同时输出 width/height 属性兜底。
3. **零第三方图标依赖**：移除 lucide-react 依赖与全部 239 处引用，图标全部来自本仓库 lib/icon-paths.ts 注册表；emoji 图标（✕、🤖）改为图标组件/角色形象。
4. **可测试、可维护**：图标注册表与渲染器分离：lib/icon-paths.ts（纯数据，可单测）＋ components/ui/icons.tsx（渲染器与具名导出）；新增图标只需加一条注册表条目。

非目标：不改信息架构、不改业务流程、不重绘 DAG 画布/角色形状（二者不是图标资产，保持现状：dag-canvas.tsx 为数据可视化 SVG，bot-shapes.ts 为角色形象库）。

---

## 2. 用户故事

| # | 角色 | 故事 |
|---|---|---|
| US1 | 日常使用者 | 我希望全站图标是同一套手绘语言（粗细、圆角、尺寸一致），而不是 lucide 与 emoji 混排，看起来像一个完整产品。 |
| US2 | 日常使用者 | 我希望图标在不同主题/明暗模式下颜色正确、对比度足够，hover/选中态跟随文字颜色。 |
| US3 | 前端开发者 | 我希望新增图标只需在注册表加一条数据，组件用 Icon name 或具名导出即可，不再引入第三方图标包。 |
| US4 | 验收者 | 我希望有自动化测试保证「每个图标都在 20 网格、只用允许的笔触/颜色、没有遗漏的 lucide 引用」。 |

---

## 3. 功能需求（FR）

### FR1 图标注册表（frontend/src/lib/icon-paths.ts）
- 定义 IconPrimitive 联合类型：path（d）、circle（cx/cy/r）、rect（x/y/w/h/rx）、line（x1/y1/x2/y2）、polyline/polygon（points）；每个 primitive 可选 fill: true（以 currentColor 填充）与 sw（局部线宽覆盖）。
- IconDefinition：prims + 可选 sw（默认 1.6）、dash（stroke-dasharray）。
- 注册 **≥75 个图标**（覆盖当前 95 个 lucide 语义名；同语义合并到同一图标，如 AlertCircle/CircleAlert、Clock/Clock3、Users/UsersRound/ContactRound、Loader2/LoaderCircle、MessageCircleMore/MessagesSquare、TriangleAlert/AlertTriangle 等）。
- 优先逐字移植 DS-Bot 源码中已有的 30+ 图标路径（plus/search/close/check/chevron/clock/gear/people/info/copy/trash/sign-out/sliders/chats/side/gauge/globe/key/lock/link/warn/eye-off/arrow-down/arrow-up(send)/reload 等），其余按同一设计语言补绘。

### FR2 图标渲染器与具名导出（frontend/src/components/ui/icons.tsx）
- Icon 组件：viewBox 0 0 20 20、fill none、stroke currentColor、圆头圆角、aria-hidden（提供 aria-label 时转为 role img）。
- 导出与现有代码同名的 95 个具名组件（Search、X、Loader2 …），使全仓替换只改 import 路径；Loader2/LoaderCircle 沿用调用方 animate-spin。
- 具名组件接受 size（默认 16）与 strokeWidth 覆盖；className 原样透传（尺寸/颜色由现有 Tailwind 类控制）。

### FR3 全量替换（33 个文件、239 处）
- 删除 lucide-react 依赖（package.json/lockfile）与全部 lucide 引用。
- 替换 3 处 ✕ 文本关闭按钮（app/settings/audit、app/settings/members、components/console/app-sidebar）为 X 图标。
- 替换 components/console/status-panel.tsx 两处 🤖 emoji 头像为角色形象（AgentPortrait/BotMark）。
- 检查其余内联 SVG（仅 bot-mark.tsx 与 dag-canvas.tsx，属角色形象/数据可视化，不在图标范围）。

### FR4 图标视觉一致性
- 图标默认颜色继承：未显式设色的图标继承 currentColor；按钮/行内图标在 hover 时由父级文字色变化驱动（保持现有 text-console-* 类）。
- 图标不参与布局宽度抖动：shrink-0 由调用方已有类提供；新增具名组件不设置 margin。
- 尺寸与线宽在 12–18px 范围视觉均衡：12px 场景使用 1.8 线宽的专用图标（link），导航/主按钮 1.6，其余 1.5。

### FR5 测试与证据
- frontend/tests/icons.test.mjs：注册表完整性（≥75、名称唯一、每个 def 非空）、全量 20×20、允许 primitive 类型、颜色只允许 currentColor/none、线宽 ∈ {1.5,1.6,1.8}、具名导出覆盖全部历史 lucide 名称、frontend/src 中 lucide-react import 为 0（仅注释出处）、无 emoji 图标残留（✕/🤖）。
- 临时 /icon-preview 路由（仅本地截图验证，不提交）渲染全部图标大图，供 A/B 归档与人工检查。

---

## 4. 数据模型

无数据库/后端变更。图标注册表为前端纯数据：

IconDefinition = { prims: IconPrimitive[]; sw?: 1.5 | 1.6 | 1.8; dash?: string }

---

## 5. 前端技术方案

- 新增 frontend/src/lib/icon-paths.ts（数据）与 frontend/src/components/ui/icons.tsx（渲染器 + 具名导出）；33 个文件仅改 import 行（lucide-react → @/components/ui/icons）。
- 图标颜色全部走 currentColor，与 --console-* 令牌联动；不新增 CSS 变量。
- 删除 lucide-react 依赖并更新 lockfile；next build 必须无引用。
- 图标预览路由 app/icon-preview/page.tsx 仅用于本地截图（截图后删除，避免产品多余路由）。

---

## 6. 里程碑

| 里程碑 | 范围 | 验收 |
|---|---|---|
| M1 图标注册表与渲染器 | FR1 FR2 | 单测通过、typecheck/lint 0 |
| M2 全量替换 | FR3 FR4 | 0 lucide 引用、0 emoji 图标、build 通过 |
| M3 视觉验收与文档 | FR5 + A/B + PRD/改动表/HANDOFF + 独立验收 | A/B 截图归档、独立验收 PASS、推送与 CI 全绿 |

---

## 7. 验收标准（AC）

- **AC1**：npm test 通过（新增 icons 用例 ≥8）；npx tsc --noEmit 0；npx eslint 0；next build 全部路由成功。
- **AC2**：frontend/src 中来自 lucide-react 的 import 为 0（注册表注释保留出处说明）；package.json 不再含 lucide-react；npm ls lucide-react 为空。
- **AC3**：注册表 ≥75 个图标，全部 20×20、允许 primitive/线宽集合、颜色仅 currentColor/无硬编码色值（单测强制）。
- **AC4**：全仓 ✕ 文本按钮与 🤖 emoji 图标为 0（单测扫描强制）。
- **AC5**：A/B 截图（HEAD 生产构建 vs 本批生产构建，1440×900 + 390×844）归档 docs/ab-20261102-icons/，共 25 张（baseline 10 + new 14 + 全图标预览 1，含 /icon-preview 大图）；导航/软件 Dock/设置/聊天/任务/工作流页面图标视觉一致、无尺寸跳变。
- **AC6**：独立验收子 Agent PASS（0 阻塞）；改动表、PRD 三处同步、HANDOFF、CI 全绿闭环。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 新绘图标与 DS-Bot 手绘风格不一致 | 严格 20 网格 + 2.5–3px 内边距 + 1.5/1.6 线宽 + 圆头；DS-Bot 已有图标逐字移植；预览页人工复核 |
| 替换导致尺寸/布局跳动 | 调用方原有 className 尺寸类保留；具名组件透传 className；A/B 截图对比关键页面 |
| 95 个语义名遗漏 | 具名导出覆盖表 + 单测强制；构建失败即暴露 |
| 删除依赖破坏构建 | 先全量替换 → npm uninstall lucide-react → build 三遍验证 |

---

## 9. 实施与验收记录（2026-11-02）

- **实现**：新增 `frontend/src/lib/icon-paths.ts`（**89 个图标**纯数据注册表：20×20 网格、线宽 1.5×69 / 1.6×16 / 1.8×2、填充 7 个、虚线 1 个；其中 28 个图标路径与 DS-Bot `client.js` 逐字一致）＋ `frontend/src/components/ui/icons.tsx`（渲染器 + **95 个历史语义同名导出** + 扩展 Plug）；新增 `components/console/agent-glyph.tsx` 统一角色/外部节点头像图形。
- **替换范围**：33 个产品文件的 lucide import 全部切换；239 处图标 JSX 用法保留原尺寸/颜色类；3 处 ✕ 关闭按钮、2 处 🤖 头像、7 处聊天/任务 emoji 头像统一为图标/角色形状；`lucide-react` 从 package.json 与 lockfile 移除（`npm ls lucide-react` 为空）。
- **质量门禁**：`npm test` **141 passed**（新增 icons 用例 11 项，覆盖注册表网格/线宽/颜色、95 具名导出、0 lucide 引用、0 emoji 残留）；`npm run typecheck` 0；`npx eslint` 0；`npm run build` 16 条路由全部成功（临时预览路由已删除）。
- **A/B 取证**：`docs/ab-20261102-icons/`（25 张 PNG：baseline 10 + new 14 + 全图标预览 1，覆盖控制台/群聊/设置/成本/任务/工作流/通讯录/移动端/命令面板/明暗主题；baseline 为 HEAD `00af490` 生产构建），结论见该目录 `README.md`。
- **独立视觉 QA**：PASS（0 阻塞）。12 条非阻塞问题中 10 条已整改（wrench/server-cog 越界、key/gauge/coins 可读性、sparkles/palette/calendar-clock/flame/cursor-click 细节、blocks 与 layout-dashboard 区分度）；留待后续：quota 页个别硬编码 amber 色（非本批引入）、自定义 emoji 头像与形状共存。
- **提交**：见《改动表》C-287（feat）与 C-288（docs 登记）；独立验收结论见改动表备注。

## 10. 系统关系

- 上游：DS-Bot 源码 src/client/icons.js 等图标定义、docs/prd/PRD-DS-Bot前端设计系统与信息架构迁移.md（令牌/语义色）。
- 下游：全站 33 个前端文件；docs/PRD.md 索引与根目录 PRD.html 由脚本同步；docs/ab-20261102-icons/ 为 A/B 取证。
- 与角色形象的关系：bot-mark.tsx / bot-shapes.ts 继续承担「角色形象」，本 PRD 只覆盖「界面图标」。

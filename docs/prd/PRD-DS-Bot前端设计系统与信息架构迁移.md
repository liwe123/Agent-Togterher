# PRD · DS-Bot 前端设计系统与信息架构迁移（UI 迁移二期）

> 类型：Requirement｜状态：M1–M3 已实施并验收（M4 遗留项见 §6/§8）｜日期：2026-11-02｜作者：LI
> 依据：`docs/DS-Bot对标分析与改造方案.md` §3、`docs/DS-Bot分析报告/DS-Bot前端UI与交互模式分析.md`（§1 设计系统 / §2 信息架构 / §3 组件 / §4 交互 / §5 可迁移清单 / §7 不要照抄）、`docs/整改项目完整计划.md` Phase 5（WP5.1~WP5.6）
> 参考项目：[Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)（DeepSeek Harness 插件社区项目，npm `@lininn/ds-bot@0.2.6`，源码内联 CSS 与组件函数可逐行取证）
> 关联：`docs/prd/PRD-群聊多Agent接力协作.md`（C-267，已落地的聊天分组/时间分隔/接力链是本 PRD 的前置）
> 本 PRD 为「多批次一次性定义」：FR 编号覆盖 Phase 5 全部 UI 迁移项，按里程碑分批实现与验收。

---

## 1. 目标

把 DS-Bot 前端在**设计系统、信息架构、聊天表面、设置与用量**四层沉淀的设计语言迁移到 Agent Console，使本产品在保留既有工程与数据能力的前提下，获得：

1. **一套可换肤的设计基座**：4 主题 × 8 颜色键 → 语义令牌层（发丝线、三级文字、中性 hover/active、accent 对比色自动推导），组件只消费语义令牌，不再逐处写死颜色/阴影。
2. **克制而高密度的层级**：以 0.5~1px 低透明度发丝线与内描边替代大圆角阴影；标题/正文/元信息形成 3 级字阶；数字统一 tabular-nums。
3. **团队产品式的信息架构**：侧栏 = 导航 rail + 团队列（Agent 即成员，活预览 + 状态点）；聊天页 = 浮动胶囊头 + 分组消息流 + 事件/typing 行 + 右侧对象详情面板；全局命令面板；设置页双栏 IA。
4. **可降级的动效**：弹簧物理参数生成 CSS `linear()` 缓动 + 三档动效（quiet/normal/lively）+ prefers-reduced-motion 全量降级。

非目标（本 PRD 明确不做）：照搬 DS-Bot 的宿主 CSS 片段编译器与 `--dsh-*`/`--dsw-*` 变量依赖；照搬 11–13px 超高密度（按现有 M3 尺度放大 1.15~1.25 倍）；照搬单文件两万行内联 CSS；不引入 ECharts 等新图表依赖；不改动后端接口与数据库。

---

## 2. 用户故事

| # | 角色 | 故事 |
|---|---|---|
| US1 | 日常使用者 | 我希望在深色/浅色、不同主题色调间切换并立即生效、刷新后保持，以便按环境偏好使用控制台。 |
| US2 | 日常使用者 | 我希望左侧团队列一眼看到每位 Agent 的状态、模型与正在做的事，而不是先跳转到通讯录。 |
| US3 | 日常使用者 | 我希望在任意页面按 Ctrl/Cmd+K 快速跳到某位 Agent、某个页面或执行切换主题等操作。 |
| US4 | 日常使用者 | 我希望在群聊中直接看到某位 Agent 的模型/状态/最近活跃等详情，而不用离开当前会话。 |
| US5 | 日常使用者 | 我希望聊天消息像团队聊天工具一样按发言人分组、按时间分隔、@ 提及时显示为带头像的行内 chip；Agent 正在处理时有 typing 提示。 |
| US6 | 日常使用者 | 我希望设置页左侧有清晰的分类导航，外观偏好（主题/强调色/动效档位）可在一个地方调整。 |
| US7 | 数据敏感使用者 | 我希望用量页可以切换 24h/7d/30d/12m 范围，看到按天堆叠柱与按模型/任务的排行，判断成本结构。 |
| US8 | 无障碍用户 | 我希望所有动效遵循 prefers-reduced-motion 与三档动效设置，键盘可完成导航/命令面板/卡片选择。 |

---

## 3. 功能需求（FR）

### FR1 设计令牌层（P0-1）
- 新增 DS-Bot 式「8 颜色键」（bg / sidebar / bubble / card / text / user / userText / accent）× 4 主题（deepseek / mono / paper / moonlight）与明暗两档，写入 `html[data-theme][class~=dark]`。
- 由颜色键派生语义令牌（`--console-*`）：bg/surface/surface-2/sidebar/raised、ink/ink-2/ink-3、line/line-2、hover/active、accent/accent-ink、user/user-ink、tag-bg/tag-ink、danger/success/warn（语义色提供明暗两档）、msg-w/panel-w/row-h、弹簧缓动与时长。
- Tailwind 映射：`bg-console-*`、`text-console-*`、`border-console-*`、`rounded-console-*` 可在组件内直接使用。
- 既有 M3 token（`--background`/`--card`/`--primary` 等）重映射到主题键，保证未改造组件同步换肤。
- 常量工具类：`.console-card`、`.console-row`、`.console-pill`、`.console-hairline(-b)`、`.console-tabular`、`.console-meta`、`.console-section-title`、`.console-kbd`、`.console-grip`、`.console-scroll`、`.console-stagger`、`.console-fade-in`、`.console-slide-up`。

### FR2 主题与外观偏好（P2-2 / P2-1）
- `lib/design-tokens.ts`：主题/强调色/模式/动效档位的类型与预设；`accentInk(hex)` 用 WCAG 相对亮度公式推导前景色（`(L+0.05)^2 > 1.05*(L(#141414)+0.05)`）。
- `hooks/use-appearance.ts`：读写 localStorage（`console.theme`/`console.accent`/`console.mode`/`console.motion`），把 `data-theme`/`data-motion`/`dark` class 与 `--console-accent`/`--console-accent-ink` 应用到 `documentElement`；默认 deepseek + 深色 + normal。
- `components/app-providers.tsx` 在根布局挂载 appearance 初始化 + 全局命令面板。
- 启动时无主题水合错误（SSR 默认 deepseek 深色，客户端读取偏好后覆盖）。

### FR3 动效体系（P2-1）
- `lib/motion.ts`：`springLinear(stiffness, damping)` 解析阻尼振荡并采样 25 点生成 CSS `linear()`，同时解出 1% 容差 settle 时长；导出 shape/tap/list/pop/stretch/lead/trail/glide 曲线常量与 `reduced()` 辅助。
- CSS 变量 `--console-ease-*`/`--console-dur-*` 与 JS 常量同源（同一实现生成，测试校验）。
- 三档动效：`html[data-motion="quiet"]` 关闭装饰性动画仅保留状态变化；`lively` 增加待机眨眼/摇摆等；`prefers-reduced-motion: reduce` 下全部退化为透明度或瞬时。

### FR4 侧栏团队列（P0-2）
- `AppSidebar` 成为「76px 导航 rail + 264px 团队列」双栏（宽屏），窄屏折叠为 rail，移动端保留底部导航。
- 团队列：工作区名 + 在线数、主 Agent 磁贴、Agent 行（36px 头像、名字 14/20、单行活预览、右侧 8px 状态点）；hover/选中使用中性叠加；行点击进入群聊并 @ 该 Agent，或回调选中打开详情面板。
- 数据：优先 props；缺省由 `use-team-roster` 拉取 `/api/v1/workspaces/my` + `/api/agents`，带骨架与错误兜底。

### FR5 控制台三栏与对象详情面板（P1-1）
- `DetailsPanel`：320–520px 可拖拽（左缘 8px 手柄、localStorage 持久化）、对象头（64px 头像 + 名字 + 角色）、分段 tab（详情/统计）、详情行；无选中对象时空态；Escape 关闭；ARIA `complementary`。
- 控制台页 xl 以上常驻右栏；群聊页桌面端复用同一组件作为成员/对象详情。

### FR6 命令面板（P1-2）
- `CommandPalette`：Ctrl/Cmd+K 打开，Esc 关闭，560px 面板；分组「页面 / Agent / 操作」；↑↓ 移动、Enter 执行、鼠标 hover；空态提示；ARIA combobox/listbox；不新增依赖。

### FR7 聊天消息表面（P0-5 / P1-3 / P1-9）
- 气泡 18px 圆角、分组首尾收窄 6px；Bot 气泡 `--console-surface-2`、用户气泡 `--console-user/--console-user-ink`；0.5px 发丝内描边替代阴影；宽度受 `--console-msg-w` 控制；hover 工具条（复制/跳任务）预留 82px。
- 发言人分组：首条显示 22px 头像 + 名字 + 11px tabular 时间；组间 16px、组内 4px。
- >30 分钟或跨天插入时间分隔；系统/事件消息渲染为居中事件行（非气泡）；typing 行 = 28px 头像 + shimmer 文案 + tabular 计时。
- 空态/加载态统一走 `ui/feedback` 原子组件。

### FR8 @ 提及 chip（P0-7）
- `linkMentions(text, agents, selfId?)` 把已知 Agent 名转为 `[Name](mention://<id>)`，排除代码块/行内代码/邮箱/路径/自指，长名优先；`message-bubble` 的 markdown `a` 渲染器把 `mention://` 渲染为带 14px 头像的行内 chip，点击直达该 Agent 会话。

### FR9 输入卡与交互语法（P0-3 / P0-6）
- 聊天胶囊头：40px、发丝描边、名字 14/20 500、右侧箭头宽度展开、滚动渐变遮罩。
- 输入卡：圆角 22px、发丝描边、聚焦 accent 外环、placeholder 三级文字、发送按钮 accent/accent-ink。
- 人工确认动作卡（ActionCard）：与问题/审批共用卡片语法（head/body/foot + raised/settled 两态），选项键帽 24px `A/B/C` 键位，单卡仲裁（同一时刻只有一张可交互），接入 `waiting_approval` 任务；键盘 A/B/C 选择。

### FR10 设置页 IA（P1-5）
- 设置页外壳「198px 粘性分页导航 + 右侧内容」，区块用 `.console-card`、行间 1px `--console-line` 分隔；选中项 `aria-current`；页面区块入场 `.console-stagger`（reduced-motion 下关闭）。
- 「外观」区块接入 FR2（主题卡/模式/强调色/动效档位）。

### FR11 用量页升级（P1-4）
- 范围 tabs（24h/7d/30d/12m）+ 环比；按天堆叠柱（纯 div/SVG）；按模型/按任务排行（32px 图标 + 名字 + 副标题 + 数字 + 占比条）；空态/骨架复用 FR7 原子组件；不新增图表依赖。

### FR12 反馈原子组件（P1-8）
- `components/ui/feedback.tsx` 导出：`EmptyState`（48px 圆底图标 + 13/18 三级说明）、`SkeletonRows`（12px 圆角条 + shimmer）、`ShimmerText`（background-clip:text 扫描，reduced-motion 停用）、`InlineError`（12px danger，role=alert）；替换各页分散的空态/加载/错误文案。

---

## 4. 数据模型

本 PRD 不新增数据库表、不改后端接口。前端本地偏好存储在 localStorage：

| Key | 取值 | 说明 |
|---|---|---|
| `console.theme` | deepseek / mono / paper / moonlight | 主题预设 |
| `console.accent` | default / ink 预设 id / #rrggbb | 强调色覆盖 |
| `console.mode` | dark / light | 明暗模式 |
| `console.motion` | quiet / normal / lively | 动效档位 |
| `console.panelW` | 320–520（number） | 详情面板宽度 |
| `console.paletteSeen` | 1 | 命令面板使用提示（可选） |

---

## 5. 前端技术方案

- 令牌分三层：**主题颜色键**（4×2，CSS 变量 `--t-*`）→ **语义令牌**（`--console-*`，color-mix 派生）→ **Tailwind 映射**（`--color-console-*`）；组件只消费第 2/3 层。
- 原子组件：`ui/feedback`（EmptyState/SkeletonRows/ShimmerText/InlineError）、`console/details-panel`、`console/command-palette`、`console/team-column`、`chat/action-card`、`chat/typing-row`、`settings/appearance-card`。
- 纯函数下沉到 `lib/`（design-tokens/motion/mention-utils/relay-utils），用 `node --test` 覆盖；React 组件不写业务判断。
- 变换动画优先 CSS transition + `--console-ease-*`；需要中断的（拖拽面板）用 CSS 变量 + 无过渡模式。
- 可访问性：所有交互有 aria-label/aria-current/aria-pressed；卡片与面板有 role；键盘可达；对比度：accent 前景由 WCAG 公式推导，正文/次级文字对比度 ≥ 4.5:1 / 3:1。

---

## 6. 里程碑（分批实现与验收，追踪表 ID 由生成脚本按提交顺序分配）

| 里程碑 | 范围 | 验收 |
|---|---|---|
| M1 设计基座与外壳 | FR1 FR2 FR3 FR4 FR5 FR6 FR12 | typecheck/lint/test/build 通过；1440×900 与 390×844 截图 A/B |
| M2 聊天表面 | FR7 FR8 FR9 | 同上 + @ chip 单测、分组/时间分隔截图 |
| M3 设置与用量 | FR10 FR11 | 设置页双栏与外观切换截图（明/暗各一张）、用量页空/有数据态 |
| M4 打磨与终验 | 全量 FR 复核 + 独立验收 | 守则 1~3 闭环，CI 三 job 全绿 |

---

## 7. 验收标准（AC）

- **AC1**：切换 4 主题 × 明暗模式，整站（侧栏/控制台/群聊/任务/设置）颜色随之变化、无硬编码白/黑底色残留；刷新后保持。
- **AC2**：强调色切换后按钮/链接前景对比度符合 WCAG AA（`accentInk` 单测覆盖 7 预设 + 任意 hex）。
- **AC3**：`.console-card`/`.console-row`/`.console-pill` 在页面中替代大部分 `border border-border/70 shadow-sm` 写法；页面无 >2px 的装饰性边框。
- **AC4**：1440px 宽下侧栏显示 rail + 团队列；1280px 下不横向溢出；<1024px 团队列自动折叠；移动端 390×844 底部导航正常。
- **AC5**：团队列状态点与 Agent 状态一致（running/idle/failed），行点击能进入对应 @ 会话。
- **AC6**：详情面板可拖拽 320–520px、刷新后宽度保持、Escape 可关闭、无选中对象时显示空态。
- **AC7**：Ctrl/Cmd+K 打开命令面板，↑↓/Enter/Esc 可用；页面分组跳转正确；不阻塞输入框键入。
- **AC8**：群聊消息按发送者分组（首条带头像/名字/时间）、>30min 有分隔、系统消息为居中事件行、typing 行在 Agent 处理中出现并在 reduced-motion 下不闪烁。
- **AC9**：@ 提及渲染为内联 chip（带 14px 头像），点击跳到对应 Agent 会话；代码块/邮箱/路径不误伤（单测覆盖）。
- **AC10**：设置页双栏导航可用，外观卡改变主题/模式/强调色/动效并即时生效；页面入场动画在 quiet 与 reduced-motion 下关闭。
- **AC11**：用量页范围切换后图表与排行数据同步更新，空数据时显示空态而非报错。
- **AC12**：`npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 全绿；A/B 截图（baseline vs new，桌面 1440×900 + 移动 390×844）归档 `docs/ab-<日期>/` 并在改动表登记结论。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 主题化改动波及全站，暗色/浅色双模式回归量大 | 令牌集中在 globals.css；A/B 只截关键页面（控制台/群聊/设置），其余页面以 token 一致性 + build 保证 |
| `linear()` 缓动在旧浏览器不可用 | 仅在 Chromium/Edge（本产品目标环境）使用；关键交互附普通 cubic-bezier 兜底 |
| 高密度与现有 M3 大留白冲突 | 按 1.15~1.25 放大；单页改动后做视觉自查，避免「挤」 |
| 团队列/详情面板改动 vs 现有页面 grid 冲突 | 统一外框 grid 为 `md:grid-cols-[auto_minmax(0,1fr)]`，断点处折叠 |
| 迁移期功能回归 | 保留现有全部功能与 API 调用；每批跑 typecheck/lint/test/build + 独立验收 |

---

## 9. 实施与验收记录（2026-11-02）

- 实施提交：`88dfd27`（feat，前端 + 本 PRD）；登记提交：`c6fed2f`（docs，PRD.html/改动表/HANDOFF/A-B 截图）。
- 质量门禁：`npm test` 130 passed（新增 49 例）/ `npx tsc --noEmit` 0 / `npx eslint` 0 / `next build` static pages 16/16、Route 表 15 条全部成功。
- A/B 取证：`docs/ab-20261102/`（22 张 PNG：6 baseline + 16 new；桌面 1440×900、移动 390×844@dpr2；deepseek 深色 + paper 浅色 + mono + moonlight + 命令面板 + 详情面板 + 设置外观 + 用量页），结论见该目录 README.md。
- 独立验收：PASS（0 阻塞；非阻塞观察 3 条已在 C-283 备注与本文档修订）。
- 遗留（不在本批验收范围）：记忆面板（依赖 Phase 2 记忆能力）、relay 暂停/继续（缺后端暂停语义）、自定义 emoji 头像与 BotMark 共存、HITL 服务端备注字段。

## 10. 系统关系

- 上游：`docs/DS-Bot分析报告/DS-Bot前端UI与交互模式分析.md`（证据源）、`docs/整改项目完整计划.md` Phase 5（WP5.1~WP5.6 对应 FR 编号）。
- 下游：`docs/PRD.md` 索引 + 根目录 `PRD.html`（生成器自动同步）、`docs/Agent_Console_变更追踪.xlsx`（每提交一行）。
- 与既有能力的兼容：C-267 接力链/成员面板/消息分组保持可用并复用本 PRD 的令牌与反馈组件；不改动后端 API/WS 事件契约。

# DS-Bot 前端 UI 设计与交互模式分析

> 分析对象：`E:\Agents\.tmp\dsbot\package\client.js`（20,143 行，esbuild 产物但未压缩，组件函数保名、CSS 模板字符串完整）。
> 分析方式：只读。先用 Select-String 定位，再分段 Read，逐条在正文标注行号区间（形如 `client.js:2551-2553`）。
> 目标读者：Agent Console（Next.js 16 + Tailwind v4 + shadcn/ui，深色 M3 风）改造实施者。

---

## 0. 结论速览（十条）

1. **一套 18 个设计变量驱动全部界面**：4 套主题 × 8 个颜色键（bg/sidebar/bubble/card/text/user/userText/accent）→ 运行时生成 17 个 `--bt-*` 语义变量（`client.js:1768-1813`）。这是整个系统能做到「换主题不破版」的根本原因。
2. **双主题不是两套 CSS，而是一次变量重写**：`html body{...}` 与 `html body[data-ds-dark-theme]{...}` 两条规则写进 `<style>`，用 `html body` 提高特异性压住宿主样式（`client.js:1820-1822`）。
3. **1px 以下是主要线宽**：大量 `.5px` 发丝线与 `inset 0 0 0 1px` 内描边替代阴影，形成「纸片 + 细线」的克制层次（`client.js:2729`、`2865`、`2970`）。
4. **动效由物理参数生成，不是手调贝塞尔**：`springEasing(stiffness,damping)` 采样 25 点生成 CSS `linear()`，并反推 settle 时长（`client.js:2181-2201`）。7 条主曲线 + 2 组 quick，派生时长 190–560ms。
5. **角色形象是产品资产，不是头像**：20 个手绘 SVG 形状、19 个 ink token、9 个状态、3 档动效等级、gaze/pet/poke 三种响应（`client.js:1383-1493`、`2394-2481`、`3592-3626`）。
6. **三栏 + 抽屉式覆盖层**：宿主侧边栏插槽内放团队列表、中栏是宿主会话、右侧固定 320px 面板（可拖到 520），新建/建 Bot/对话/语音则用全高 `bt-pane` 从右滑入（`client.js:2729`、`2702`、`13039`、`13216`、`13484`）。
7. **聊天页头部是浮在内容上的胶囊**：宿主 header 被改成绝对定位透明层，上方再叠一条渐变遮罩，内容从胶囊下穿过（`client.js:3296-3299`）。
8. **所有人工确认共用一套卡片语法**：提问、Widget、密钥、浏览器接管四类卡都是 `bt-q` 系，区别只在 head/body/foot 组合与 raised/settled 两个修饰态（`client.js:2578-2650`、`3922-4046`、`6201-6225`、`6487-6561`、`4168-4228`）。
9. **卡片只出现一次靠计数器仲裁**：`noteCards`（行内已画）与 `noteHeldCard`（浮层已认领）双向计数，避免同一次 `ask_user` 在转录与输入框上方重复出现（`client.js:8244-8266`、`3872-3885`）。
10. **@ 提及是「带脸的行内引用」**：`@Name` 被转成指向 `bots.local` 的 Markdown 链接，渲染时用该 Bot 的 SVG mask 做 16px 头像前置图标，无下划线，点击直达其会话（`client.js:1936-1946`、`2563-2564`、`7274-7280`）。

---

## 1. 设计系统

### 1.1 四套主题的 8 个颜色键

`THEME_KEYS = [bg, sidebar, bubble, card, text, user, userText, accent]`（`client.js:1768`）。四套主题各给 light/dark 两份（`client.js:1769-1790`）：

| 主题 | 模式 | bg | sidebar | bubble | card | text | user | userText | accent |
|---|---|---|---|---|---|---|---|---|---|
| deepseek | light | #fcfcfc | #f7f7f7 | #eeeeee | #ffffff | #141414 | #070707 | #fcfcfc | #4d6bfe |
| deepseek | dark | #141414 | #1b1b1b | #262626 | #1f1f1f | #f2f2f2 | #f2f2f2 | #141414 | #5b7bff |
| mono | light | #ffffff | #f9f9f9 | #f0f0f0 | #ffffff | #0d0d0d | #0d0d0d | #ffffff | #0d0d0d |
| mono | dark | #0f0f0f | #171717 | #242424 | #1c1c1c | #f4f4f4 | #f4f4f4 | #0f0f0f | #f4f4f4 |
| paper | light | #faf9f5 | #f3f0e8 | #ebe7dc | #ffffff | #1f1e1b | #2b2a26 | #faf9f5 | #d97757 |
| paper | dark | #1f1e1b | #262521 | #34322d | #2a2925 | #f3f0e8 | #f3f0e8 | #1f1e1b | #e08a6d |
| moonlight | light | #f7f9fc | #eef2f8 | #e5ebf5 | #ffffff | #121826 | #1e3a8a | #ffffff | #1e86ff |
| moonlight | dark | #0b1020 | #10172a | #1a2340 | #141c33 | #e8edf7 | #3b6fd8 | #ffffff | #4f9dff |

关键设计判断：

- **user / userText 是一对「反色面」**，用户气泡直接用 `--bt-user` + `--bt-user-ink`（`client.js:3477`）。因此主题切换时用户气泡永远与背景强对比，不需要单独给用户气泡配色。
- **accent 在暗色里单独提亮**（#4d6bfe→#5b7bff、#d97757→#e08a6d），保证暗底上的对比。
- **8 个键足以派生全部界面**：hover/active 不用主色，而是用中性灰叠加（`rgba(160,160,160,.12)` / `rgba(119,119,119,.09)`，`client.js:1805-1806`），所以 accent 可以任意换而不影响交互态。

### 1.2 accent 的对比度与暗色映射

- 内置 accent ink 七选一：`deepseek / charcoal / graphite / rose / sky / tangerine / cobalt`（`client.js:1373`），支持任意 `#rrggbb` 自定义（`isHex`，`client.js:1375`）。
- `accentInk()` 用 WCAG 相对亮度决定按钮文字用 `#141414` 还是 `#ffffff`（`client.js:1791-1792`）：

```
accentInk = (accent) => (luminance(accent) + 0.05) ** 2 > 1.05 * (luminance('#141414') + 0.05)
  ? '#141414' : '#ffffff'
```

  实现上用「平方后的亮度比」近似对比阈值，单调可控，避免逐色手填前后景色。
- `darkAccent()`：当用户选的 accent 恰是某个 ink 的浅色值时，暗色主题换成该 ink 的深色值（`client.js:1816-1819`，`INKS` 表 `client.js:1351-1371`）。
- 设置页把 accent 做成 7 个圆点 + 1 个「主题默认」斜切块 + 1 个彩虹 conic 自定义拾色器（`client.js:16013-16036`、`3077-3080`）。

### 1.3 `--bt-*` token 体系（分层）

`themeVars(mode, dark, accent)` 输出 17 个变量（`client.js:1794-1813`），另有 body 级常量补充（`client.js:2388`、`2391`）：

| 层 | 变量 | 值 | 用途 / 证据 |
|---|---|---|---|
| 表面 | `--bt-main` | theme.bg | 主列表面、面板、浮层底（`2729`、`3008`） |
| 表面 | `--bt-sidebar` | theme.sidebar | 侧栏、设置导航、badge 描边（`2834`、`2474`） |
| 表面 | `--bt-card` | theme.card | 卡片、菜单、输入框底（`2578`、`2661`、`2775`） |
| 表面 | `--bt-bubble` | theme.bubble | Bot 气泡（`2551`） |
| 反色面 | `--bt-user` / `--bt-user-ink` | theme.user / userText | 用户气泡、CTA 反色（`3477`、`2644`） |
| 文字 | `--bt-ink` | theme.text | 主文字（`2388`） |
| 文字 | `--bt-ink-2` / `--bt-ink-3` | text @ .6 / .36 | 次级 / 三级文字（`2517`、`2758`） |
| 线 | `--bt-line` / `--bt-line-2` | text @ .08 / .15 | 分隔线 / 结构线（`2865`、`2729`） |
| 线 | `--bt-line-weak` | text @ .1 | 极弱分隔（`2388`） |
| 交互 | `--bt-hover` / `--bt-active` | 中性灰叠加 | 悬停 / 选中（`2495`、`2507`） |
| 交互 | `--bt-accent` / `--bt-accent-ink` | accent / 对比色 | 发送、选中、未读、链接（`2674`、`2518`） |
| 标签 | `--bt-tag-bg` / `--bt-tag-ink` | text @ .06~.09 / .58 | 角色 tag、来源 chip（`2516`、`6360`） |
| 语义 | `--bt-danger` `--bt-green` `--bt-star` | #e02135 / #00c972 / #ff9800 | 错误、完成、待办（`2388`，暗色未重映射，见 §7） |
| 控件 | `--bt-knob` | #ffffff | 滑杆拇指（`3104`、`6372`） |
| 字体 | `--bt-font` | `var(--dsw-font-family, -apple-system…)` | 全组件统一字族（`2388`） |
| 角色色 | `--bt-ink-<name>` × 19 | 每 ink 的 light/dark 值 | Bot 名称着色、图表系列、accent ink（`2392-2393`、`5186`） |

布局型变量（写在 body 或组件上，不进主题）：

| 变量 | 默认 | 含义 / 证据 |
|---|---|---|
| `--bt-msg-w` | .8（50–100，步长 5） | 气泡可占列宽比例（`1877-1881`、`2549`） |
| `--bt-flat-w` | 1 | flat 布局文本宽度（`2549`、`2982`） |
| `--bt-panel-w` | 320px（320–520） | 右面板宽度（`2729`、`17026-17029`） |
| `--bt-mem-w` | 运行时测量 | HeaderPill 记忆提示展开宽度（`2530`、`9396`） |
| `--bt-size` | 头像尺寸 | badge 尺寸/位置按头像比例（`2477`、`3699`） |
| `--bt-origin` | top left | 浮层 transform-origin（`3008`、`3014`） |
| `--bt-placeholder` | 由 JS 注入 | 输入框占位文案（`3372-3374`、`9436`） |
| `--bt-first-sep` | 由 JS 注入 | 首条时间分隔内容（`3283`、`9419-9423`） |
| `--bt-steer-unread` | 由 JS 注入 | 「未读」小字（`3432-3433`、`9439`） |
| `--bt-fill` | 运行时 | range 已填充比例（`3102`、`15983`） |
| `--bt-key` | 24px / 34px | 选项键帽尺寸，有描述时 34（`2601`、`2604`） |
| `--bt-caption-band` | 计算值 | Windows 标题栏让位（`2700-2701`） |

### 1.4 亮暗双主题的实现方式

```
themeCss = (theme, accent) =>
  'html body{' + declarations(themeVars(theme.light,false,accent ?? theme.light.accent)) + '}' +
  'html body[data-ds-dark-theme]{' + declarations(themeVars(theme.dark,true,darkAccent(accent) ?? theme.dark.accent)) + '}'
```

（`client.js:1820-1822`）

要点：

1. **暗色由宿主属性驱动**：`[data-ds-dark-theme]` 是 DSH 外壳写在 `<body>` 上的，插件不自己存明暗，只跟随（`client.js:2391`、`2579`、`2826`）。
2. **`html body` 双标签选择器**是为了压过宿主（DSH）自身的 body 变量声明；主题切换时整块变量被替换，不需要逐组件写 `.dark` 变体。
3. **深色下的局部覆盖**只写「需要偏离变量」的地方：`.bt-q` 的描边与内线在暗色改为 `rgba(255,255,255,.16/.12/.08)`（`client.js:2579`），scrim 从 .32 加深到 .5（`client.js:2825-2826`）。
4. **主题预览片** `.bt-theme-chip` 用每组 3 个变量（`--ls/--lb/--la` 与 `--ds/--db/--da`）画「左浅右深 + accent 圆点」的 46×30 小卡（`client.js:3085-3088`）。
5. **与宿主视觉对齐**：`shellTokens()` 把主题色映射到宿主的 `--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` / `--dsw-alias-label-primary|secondary|tertiary`，让外壳侧栏与插件面板同色（`client.js:1823-1830`）。

### 1.5 形状、线宽、圆角、阴影、间距、字号

**线宽**（几乎没有 1px 以上的实线）：

- `.5px`：面板左边界、设置卡片行间、tab 描边、气泡工具条外环、表格内线（`2729`、`2865`、`2879`、`6335`）。
- `1px`：输入框、下拉、面板边框、下拉菜单（`2775`、`3074`、`2661`、`2903`）。
- `1.5px`：拖放区虚线（`2805`）。
- `2px`：focus ring `outline:2px solid var(--bt-accent)`（`2589`、`2611`）。

**圆角阶梯**（同一套值在全站复用）：

| 半径 | 用途 | 证据 |
|---|---|---|
| 4px | 角色 tag、来源 chip、键帽外的小标签 | `2516`、`6360` |
| 6px | 图标按钮 hover、关闭按钮 | `2575`、`2986` |
| 8px | 输入框、菜单项、调色板行、滑块 | `2775`、`3009`、`3039` |
| 10px | 侧栏行、表格容器、下拉列表 | `2510`、`2903`、`6333` |
| 12px | 菜单、头像编辑浮层、卡片、btw 卡 | `3008`、`2784`、`2864`、`3489` |
| 16px | 问题卡 / Widget 卡、设置对话框 | `2578`、`2827` |
| 18px | 消息气泡、用户气泡 | `2551`、`3477` |
| 20px | 记忆对话框 | `3126` |
| 22px | 输入卡片、创建向导输入条 | `2671`、`3356` |
| 999px | 胶囊、分段控件、调色板选中片 | `2525`、`3097`、`3090` |

**阴影策略**（三层，全部低透明度）：

- 微浮起：`0 2px 8px -1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)`（HeaderPill `2525`、输入卡 `3356`）。
- 浮层：`0 10px 20px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)`（菜单 `3008`、反应条 `2990`）。
- 对话框：`0 24px 80px rgba(0,0,0,.24)`（设置 `2827`、记忆 `3126`）。
- 常态表面**不用阴影用内描边**：`box-shadow: inset 0 0 0 1px var(--bt-line-2)`（问题卡 `2578`、输入框 `2775` 的 focus 也走 border-color）。

**间距节奏**：2 / 4 / 6 / 8 / 10 / 12 / 16 / 20（gap 与 padding 基本落在这一组）。关键尺寸：

| 尺寸 | 值 | 证据 |
|---|---|---|
| 侧栏行高 | 54px（rail 44px） | `2510`、`2521` |
| 主 Bot 磁贴 | 95px 宽 / 60px 头像 / 20-15 padding | `2504-2508`、`8619` |
| 面板宽 | 320（详情）/ 520（浏览器） | `2729`、`17026` |
| 聊天内容列 | 宿主变量 `--dsh-chat-content-width`，缺省 748 | `2578`、`2636` |
| 设置对话框 | 1100 × 780，导航 198 | `2827`、`2834` |
| 命令面板 | 560 宽，列表 402 / min(402, 54vh) | `3020`、`3032` |
| 记忆对话框 | 680 × 760 | `3126` |
| 输入卡 | min-height 44，padding 7.5，圆角 22 | `3356` |
| 消息块间距 | 组间 16，组内 4 | `2565` |

**字号 / 行高**（无 4 的倍数强迫症，而是「字号 + 4~6」的行高公式）：

| 角色 | px/lh | 字重 | 证据 |
|---|---|---|---|
| 侧栏名 | 14/20 | 400 | `2514` |
| 侧栏预览 | 13/18 | 400 | `2517` |
| 磁贴名 | 13/18 | 400 | `2508` |
| 角色 chip | 11/16 | 400 | `2509` |
| HeaderPill 名 | 14/20 | 500 | `2525-2528` |
| 气泡正文 | `--dsh-content-font-size`(14) / +10 | 400 | `2551` |
| 组名 | 13/22 | 600 | `2572` |
| 问题卡标题 | 15/22 | 600 | `2584` |
| 问题卡选项 | 14/20 | 500 | `2607` |
| 选项描述 | 12/17 | 400 | `2608` |
| 面板名 | 17/24 | 500 | `2747` |
| 面板正文 | 13/18 | 400 | `2757` |
| 设置行 | 13/18 | 400 | `2866` |
| 设置提示 | 12/16 | 400 | `2873` |
| 记忆摘要 | 15/26 | 400 | `3141` |
| 记忆条 | 14/20 | 400 | `3173` |
| 指标值 | 22/28 | 600 | `6326` |

数字全部 `font-variant-numeric: tabular-nums`（时间 `2574`、键帽 `2601`、统计 `2768`），避免数字跳动。

### 1.6 动效参数

`springEasing` 用解析解求出阻尼振荡曲线，再采样 25 个点写成 CSS `linear()`，同时解出 1% 容差下的 settle 时长（`client.js:2181-2193`）：

| 常量 | stiffness / damping | 派生时长 | 用途 |
|---|---|---|---|
| SPRING_SHAPE | 400 / 31.2 | ≈420ms | 形状/高度/宽度变化（面板宽度、morph、卡片入场）`2194` |
| SPRING_TAP | 900 / 48 | ≈290ms | 按压回弹、菜单弹出 `2195` |
| SPRING_LIST | 484 / 35.2 | ≈190ms | 列表项位移（FLIP）`2196` |
| SPRING_STRETCH | 320 / 20 | ≈560ms | 记忆提示展开（慢、带过冲）`2197` |
| SPRING_POP | 500 / 22 | ≈430ms | 勾选、色点、图标弹入 `2198` |
| SPRING_LEAD | 784 / 48.2 | ≈320ms | 滑动选中框前缘 `2199` |
| SPRING_TRAIL | 289 / 29.2 | ≈300ms | 滑动选中框后缘 `2200` |
| QUICK lead/trail | 900/51、400/34 | ≈300 / 440ms | 命令面板、下拉的快速滑动 `2201` |
| GLIDE（侧栏） | 1000 / 63 | ≈290ms | 侧栏行重排 `8828` |
| 面板 lead/trail | 576/39.4、144/19.7 | ≈360 / 370ms | 面板开合与视图切换 `17035-17036` |

> 时长为按同一公式复算值（原文件不存该常量）。`spring(curve, ...props)` 把曲线拼成 transition 序列（`client.js:2202`）。

四个「非 CSS」的动效原语：

- `useGlide`：DOM 里找 `aria-selected/aria-pressed/aria-current` 的节点，实时算 offset 与尺寸，用 RAF 双弹簧驱动 thumb 的 translate 与 width（`client.js:2251-2308`，`liveSprings` 在 `2203-2249`）。这是「滑块永远贴住选中项」的实现，且不需要每处手写测量。
- `useFlip`：列表重排时记录旧 offsetTop，逐项反向 translateY 再回弹；新项走 180ms 的「模糊淡入」（`client.js:2318-2339`）。
- `useMorph`：容器高度变化时 animate height，并带动画去重（id 为 `bt-morph`）（`client.js:2340-2372`）。
- `useLinger`：关闭浮层时先保留节点 ms 毫秒做退场，reduced-motion 下改为 0（`client.js:2373-2384`）。

**reduced-motion 策略**：JS 侧 `matchMedia('(prefers-reduced-motion: reduce)')` 统一入口（`client.js:2163`），CSS 侧 36 处 `@media` 覆盖（`2473` 一次关掉所有 mark 动画；`3054`、`3223`、`3346-3353` 把位移/模糊退化为 `bt-fade`）。不是「全关」，而是「降级为纯透明度」。

**三档动效等级**（设置 → Bots → Animation）：`body[data-bt-motion=quiet|normal|lively]`（`client.js:2400-2415`、`16136`）。

- quiet：只有状态动画，无 hover 蹭头、无 gaze、不可戳。
- normal（默认）：加 hover 蹭头 `bt-nuzzle`、眼睛跟随指针、可戳。
- lively：加待机眨眼 `bt-blink-idle`、四种 fidget（hop/sway/stretch/look）、「?」badge 在头顶弹跳 `bt-q-ride`。

---

## 2. 信息架构

### 2.1 全局骨架

```
宿主侧栏插槽 ── TeamSidebar（bt-side）
中部会话列  ── 宿主 conversation（插件只注入 header pill / rows / composer skin）
右侧固定层  ── BotPanel（bt-panel，320–520，可拖拽）
右滑全高页  ── bt-pane（新建/建 Bot/对话/语音，left 由 usePaneLeft 计算）
全屏模态    ── bt-settings-layer（1100×780）、bt-mem-layer（680×760）、bt-palette-layer（560）
```

证据：`bt-side` `2490-2522`；`bt-panel` `2729-2737`；`bt-pane` `2702`，渲染点 `13039`/`13216`/`13484`；设置层 `2824-2861`；记忆层 `3124-3202`；命令面板层 `3018-3054`。

面板会让中栏让位：`[class*='_centerCol']{transition:margin-right SPRING_SHAPE}`（`client.js:2733`），拖拽时直接改 `margin-right` 并临时禁用过渡（`17889-17904`）。窄视口下 `overlayAt(view, viewport)` 判定为覆盖模式，面板宽 100vw（`17030-17031`、`18075`）。

### 2.2 侧边栏

**顶部行**（仅宽态）：品牌（鲸鱼 mark + DS Bot）、更新云、搜索、新建、收起（`client.js:8902-8909`；样式 `2491-2494`）。窄态只剩更新与新建（`8910-8915`）。

**列表顺序**：主 Bot 磁贴固定在最上（`8920`），其余按 `pinned desc` 再按最近活动 `desc` 排序，Bot / 群聊 / DSH Agent 混排（`client.js:8863-8872`）。隐藏对象不显示，除非它是当前会话或主 Bot（`8599`、`8658`）。

**主 Bot 磁贴**（`bt-tile`）：95px 宽、60px 头像、名字 13px、可选角色 chip、选中态 `--bt-active` 背景（`2504-2509`、`8606-8622`）。

**行（BotRow / RoomRow / AgentRow）**解剖（`client.js:8624-8645`）：

| 槽位 | 内容 | 证据 |
|---|---|---|
| 左 | 36px 头像（RoomAvatar 为最多 4 个成员的集群 + 「+n」） | `8636`、`8675`、`3707-3749` |
| 名 | 名字 + 置顶图钉 + （群聊）admin 标记 | `8641`、`8680` |
| 预览行 | 单行省略，优先级：正在做的事 → 在群里做事 → 等待谁 → 最后一轮摘要 | `8642` |
| 右 | 未读点（accent 8px）/ 待审批点（star 色） | `8644`、`8683`、`2518-2519` |

预览文案不是静态摘要，而是「活的」：`workLine()` 拼成 `名字 · 动词… +n`，用 shimmer 动画（`8573-8574`、`8595-8598`）。等待态是 `Waiting for A and B`（`8575-8578`）。

**未读与已读**：进入会话即 `clearUnread`（`8563-8567`）；`marked` 来自 UI store 的手动标记（`8856`、`8585`）。

**Agent 行可展开**：`grid-template-rows: 0fr → 1fr` 过渡（`9356-9358`），子行 30ms 逐个模糊淡入（`9368-9369`），子行可内联重命名（`8686-8724`）。

**窄态 rail**：44px 行高、居中头像、图钉绝对定位到右上角（`2520-2521`、`9319-9320`）。

**键入即搜索**：侧栏任意可打印字符（非输入框、无修饰键）直接打开命令面板并把该字符作为首查询（`8893-8898`）。

### 2.3 聊天页

**浮动胶囊头（HeaderPill）**：宿主 header 被强制改为绝对定位、透明、`pointer-events:none`，只保留 60px 高的渐变遮罩，内容从下面穿过（`client.js:3294-3299`）。胶囊本体：高 40、圆角 999、`.5px` 描边、双层微阴影、最大宽 70%、左侧 24px 头像（无 badge）、名字 500 字重、悬停时右侧「进入箭头」以宽度+透明度展开（`2524-2546`、`9453-9471`）。点击行为：默认打开右侧详情；若正在看 Browser/Side chat，则变为「Back to chat」（`9465`）。

**记忆提示**：胶囊内嵌一个 0 宽的槽，检测到记忆更新时按测量宽度展开，中间用 1px 竖线分隔，图标弹入（`2529-2537`、`9391-9402`）。

**Transcript 结构**：

- 组容器 `.bt-group-msg`：上间距 16（`2565`）。
- 发言人头 `.bt-group-name`：22px 头像 + 名字 + 时间（11px，tabular）+ 耗时（`2571-2574`、`7576-7584`）；群聊里名字用该 Bot 的 ink 色（`7598`）。
- 消息列 `.bt-astack`：有头像列时，非末条消息左移 30px（22 头像 + 8 gap），使后续气泡与首条对齐（`2570`、`2972`）。
- 气泡分组圆角：首条起 `6px`，末条止 `6px`，中间两侧 6（`2552-2553`）。
- 时间分隔：`.bt-time-sep` 高 28、12px 文字、上下 14/8 间距（`3282`）；超过 30 分钟才插入（`7939`）。
- 首条分隔用伪元素 + CSS 变量注入，避免在流里多插一个节点（`3283`、`9419-9423`）。
- 「新消息」分隔：accent 色、11px、大写、两侧 20% accent 细线（`3468-3469`、`7915-7917`）。

**事件行（GroupEvent / EventLine）**：居中单行，最小高 24，12px，`--bt-ink-2`；内部元素是**按钮**（点头像/名字可跳转），长名字用省略号且不能换行（`3271-3281`、`7549-7574`、`7620-7626`）。事件类型覆盖：入群、记忆保存、密钥使用、接力暂停、被重启打断、审批暂停、完成等（`8191-8228`、`7648-7681`）。

**Typing 行**：36px 高，28px 头像（可戳）+ shimmer 动词 + 右侧计时；进场用 SPRING_TAP 从 .9 缩放淡入，退场 .14s 模糊缩小；宿主滚动容器的高度变化被 140ms 的 translateY 补偿，避免「跳一下」（`3324-3340`、`8462-8547`、`8520-8530`）。

**Flat 布局**（设置可切）：气泡背景/内边距/圆角全部归零，文本占 `--bt-flat-w` 宽度，工具条改为浮在消息右上角的胶囊（`2981-2985`、`2966`）。

### 2.4 右侧详情面板

**三段结构**：`bt-drawer-top`（右侧一排 36px 圆钮：设置、更多、分享、关闭）→ `bt-drawer-id`（64px 头像 + 可点改的名字 + 角色副标题）→ `bt-tabs`（Details / Browser，滑块跟随）→ `bt-drawer-body`（13/18，gap 16，padding 20/16）（`client.js:2738-2757`、`16922-17012`）。

**子视图切换**：overview ↔ settings 用 `data-move=in|out` 触发 `bt-page-in/out` 水平位移，第 2/3 项加 25/50ms 延迟（`3213-3217`）；tab 切换只做淡入（`3217`）。

**拖拽改宽**：左边缘 8px 手柄（`left:-5px`），悬停显一条 2px 竖线（`2734-2735`）；拖拽时全窗覆盖 `.bt-drag-shield` 保持 resize 光标（`2736`、`17941`）；宽度范围 320–520（browser 360–视口-420），持久化到 localStorage（`17026-17029`、`17068`、`17911-17914`）。

**内容**：运行统计（turns / tok/s / cache hit / context%，`2766-2769`、`16678+`）、模型选择、权限、工作目录、指令、记忆入口、用量、定时任务（`16984-17008`）。群聊则是成员堆叠 + 每人的状态行（`16821-16859`、`16780-16820`）。

### 2.5 命令面板（CommandPalette）

560 宽居中，圆角 12，24px 阴影；头部 15px 输入 + 搜索图标 + 清除；列表 402 高（`min(402,54vh)`）分四段：Bots / DSH Agent / Messages / Commands（`client.js:10562-10614`）；空态是 32px 灰图标 + 「No results」+ 一行提示（`10677-10682`、`3049-3053`）。

交互：↑↓ 移动（选中片用双弹簧纵向滑动，`10618-10621`）、Enter 执行、Esc/点遮罩关闭（带 160ms 退场，`10532-10536`）、输入 ≥2 字符才做消息全文检索（最多 30 条，带 24 字符上下文，`10539-10560`）、悬停跟随光标（`10699-10701`）。

### 2.6 记忆面板（bt-mem-layer）

680×760、圆角 20；头部 60px：标题 17/24 600 + 状态（条目数/大小，tabular）+ 溢出菜单；正文 22/28 的内边距，摘要用 17/26 标题 + 15/26 正文（这是全站最大的行高，读长文用）；条目行 36px 起，hover 才显示删除，**删除需要二次点击确认**（第一次变成红底「确认删除」）（`client.js:3118-3202`、`12216-12358`）。底部固定 52px 胶囊输入（`bt-mem-ask`）与 16px 圆角的回复气泡（`3182-3198`）。

加载态是 3 组 shimmer 骨架（12px 条 + 30% 宽的标题条，1.4s 循环）（`3150-3154`）；空态是 48px 圆底图标 + 标题 + 说明（`3156-3160`）。

### 2.7 用量页（Usage）

住在设置里但**独立滚动**，切页时用 `content-visibility:hidden` + 绝对定位保持布局（`2841-2844`、`16301-16306`）。

结构：范围 tabs（24h / 7d / 30d / 12w / 12m / Custom，自定义走日历选区间）+ 环比数字 + 堆叠柱图（按 Bot 或按模型，最多 7 条序列 + More + Other）+ 排行行（名字/副标题/数字/占比条）+ 单人档案（环形进度）+ 53 周热力日历（`14495-14718`、`14012-14013`、`14718-14885`）。空态复用主 Bot 的鲸鱼形象并让它动起来（`14593-14603`）。

### 2.8 设置页

1100×780 模态，左导航 198px（`bt-settings-nav`）+ 右页（`bt-settings-main`）；导航项 13/20、padding 6/8、圆角 8，选中片用 `useGlide` 纵向滑动（`2827-2839`、`16235-16262`）。

13 个分页：General / Models / Bots / Group chats / Connectors / Remote control / Capabilities / Browser / Scheduled tasks / Usage / Secrets / Feedback / About（`client.js:15932`）。带 id 进入时（某个 Bot / 群 / 用量聚焦）头部出现返回箭头，标题替换成对象名（`16228-16234`、`16279-16280`）。

页面入场：所有直接子节点做 SPRING_SHAPE 的 10px 上移 + 模糊淡入，第 2/3/4/5+ 项错 30/60/90/120ms（`2850-2857`）；前进/后退方向用 `data-move` 区分左右位移（`2858-2859`）。

---

## 3. 关键组件与视觉语法

### 3.1 角色形象（BotMark / BotAvatar / RoomAvatar）

**形状系统**：20 个手绘形状（whale / star / moon / wave / squircle / bull / blossom / gumdrop / peanut / saucer / bunny / kitty / beacon / plus / magnet / acorn / pebbles / cushion / ring / gem），每个形状由 `body`（主体路径）、`shade`（14% 黑投影）、`light`（16% 白高光）、`eyes`（2 个 [cx,cy,w,h,tilt]）构成（`client.js:1383-1404`、`1841`）。

渲染时：

- 眼睛用 `<rect rx=w/2>` 旋转，形成「竖椭圆瞳孔」；另有一份 `bt-eye-happy` 的弧线路径（opacity 0），供蹭头时切换（`1459-1460`）。
- 眼睛被做成 **mask 的洞**，主体通过 `mask` 渲染，所以眼睛天然「透出背景」，任何底色或渐变都能正确显示（`1461-1480`）。
- 渐变 ink（aurora）用 `linearGradient` 作为 mask 的填充（`1474-1475`）。
- 同一形状+颜色有 markup 缓存，mask 有 url 缓存（`1466-1493`）。

**身份稳定性**：没设颜色/形状时，用 `fnv1a(id)` 派生一个 8 色之一与 7 形状之一，因此同一个 Bot 在任何设备上长得一样（`1413-1429`、`1431-1438`）。

**尺寸档**：16（事件行图标）/ 22（发言人头像、面板小卡）/ 24（胶囊头、面板 tab）/ 28（typing、密钥卡）/ 36（侧栏行）/ 60（主 Bot 磁贴）/ 64（详情面板）。

**9 个状态**（`client.js:3592`）：

| 状态 | 触发 | 动画 | 证据 |
|---|---|---|---|
| idle | 不在运行、无提问 | 静止（lively 下眨眼 + fidget） | `2403-2412` |
| thinking | 本轮刚开始、无工具、或切换目录 | `bt-ponder` 2.2s + 眯眼 | `2431-2432` |
| searching | 工具名匹配 search/fetch/browse/read/grep/glob/list/recall | `bt-seek` 1s + 眼球扫视 | `2433-2434`、`3594` |
| working | 其余工具 | `bt-bob` 1.6s；按形状再分 wiggle / squash | `2435-2438` |
| sending | 工具名是 message_bot / create_bot / post_to_group 等 | `bt-dash` 1.1s | `2439`、`3594` |
| orbit / waiting | 等队友 / 等某人 | `bt-sway` + `bt-roll` 2.6s | `2441-2442` |
| alert | 有提问或待审批 | `bt-hop` 两次（lively 无限） | `2445-2448` |
| done | 从非 idle 回到 idle 的瞬间 | `bt-done` 1.8s 一次（弹性缩放） | `2449-2451`、`3676-3692` |

**角标**：working = 8px 绿点；alert = 12px accent 圆内「?」（8.5px 字）；admin = 12px 星；main = 按头像比例缩放的星形徽章，用 `paint-order:stroke` 描边抠出侧栏底色（`2474-2481`、`3693-3706`）。

**Gaze**：`pointermove` 监听 + rAF，把指针相对头像中心的偏移归一化到 -1..1 写入 `--bt-gx/--bt-gy`，主体位移 5%/4%，瞳孔层位移 12%/11%，transition 180ms（`3595-3626`、`2427-2430`）。

**Pet（蹭头）**：指针在行/磁贴内时，头像 rotate 8° 并向指针方向平移，0.32s 后开始 0.78s 的 nuzzle 循环，眼睛切换成笑弧（`2416-2428`）。命中区用一个 `inset:-20%` 的伪元素扩大（`2419`）。

**Poke（戳）**：点击后 0.8s 内做一次 `translateY(-16%) rotate(360deg)` 的整圈弹跳，动画结束自动清除类名（`2452-2454`、`3650-3653`）。quiet 档位下两者都被禁用（`2455-2456`）。

**群聊形象（RoomAvatar）**：1 人时给「Bot + 你」两个座位；≤20px 且多人时退化为横向堆叠（负 30% 重叠 + 「+n」）；否则用 1/2/3/4 座位布局，每个座位的圆形裁切用径向渐变 mask 互相挖洞，第 4 位超员显示「+n」（`3707-3749`、`2482-2488`）。

### 3.2 消息气泡

- 基础：圆角 18、padding 7/12、字号跟随宿主内容字号、行高 = 字号 + 10、`overflow-wrap:anywhere`、`text-wrap:pretty`（`2551`）。
- 宽度上限：`min(calc(--bt-msg-w * 100%), calc(100% - 82px))`，那 82px 是给 hover 工具条预留的（6px 间隙 + 3 个 24px 按钮 + 2px gap）（`2551`、`2966`）。
- 分组圆角：首条左上 6、末条左下 6（`2552-2553`）。
- 悬停工具条：绝对定位到 `left:100%`，`opacity/visibility` 120ms 切换；用 10px 的 `::after` 搭「悬停桥」防止鼠标移过去时丢失 hover（`2973-2978`）。
- 工具栏内是 24px 图标按钮（复制/下载/反应/更多），反应条是固定定位的 6 emoji 胶囊，逐个 20ms 错峰弹入（`7341-7342`、`2990-3002`）。
- 触屏：工具条改成右上角常驻胶囊，按钮 44px，消息可点开工具条（`3406-3414`、`7313-7316`）。
- 用户气泡：`--bt-user` + `--bt-user-ink`，18 圆角、7/12 内边距，hover 才出现右侧 24px 操作按钮（`3477`、`3434-3441`）。
- 长文折叠：1500 字符 / 25 行阈值，折叠时底部 40px 渐变遮罩（`6869-6871`、`2716`）。

### 3.3 问题卡片（bt-q）

**外壳**：`max-width: var(--dsh-chat-content-width, 748px)`，圆角 16，`--bt-card` 底，`box-shadow: 0 1px 3px rgba(20,20,20,.04), inset 0 0 0 1px edge`，内边距 14/16，垂直 gap 12（`2578`）。

**两种形态**：

- `bt-q`（行内/转录内）：标题与选项之间有一条 1px 分隔线，选项之间有 5% 的细线，hover 时相邻细线淡出（`2592-2596`）。
- `bt-q-raised`（浮在输入框上方）：宽度 = 内容宽 - 32，取消所有分隔线，head 14/16/4/20，选项 gap 仅 4 且更矮，整体像「弹出菜单」而非卡片（`2636-2649`）。

**选项行**：左侧 24px 键帽（A/B/C，tabular），右侧标题 14/20 500 + 描述 12/17 次级色；有描述时键帽变 34px 圆角 10 以跨两行（`2591-2608`）。键盘 A/B/C 直接选，第 N+1 个字母聚焦「自定义答案」（`3888-3921`）。**同一时刻只允许一张卡监听字母键**（用全局计数器 `optionKeyCards` 仲裁，`3892-3904`）。

**已答态（settled）**：卡片变矮（gap 6、padding 12/16），标题降为 14/20 500，键帽 40% 透明，选项文字 45% 混色，右侧出现对勾（`2609-2619`）；被忽略时标题变次级色并显示虚线圆角「Dismissed」徽章（`2620`、`4047-4061`）。

**自定义输入**：`field-sizing:content` 的 textarea，最多 120px 高，`focus-within` 时边框加深（`2621-2626`）。

### 3.4 Widget 卡片（show_view）

**声明式 schema**：布局 `stack/row`；展示 `text/metric/table/chart/progress/callout/sources/html`；输入 `slider/number/choice/toggle`；作答 `options/confirm/form/submit`（`client.js:4565-4575`）。带公式引擎（`=` 开头的单元格走 `compileFormula`，`4298-4564`）与严格校验/上限（深度 8、节点 64、子 16、文本 2000、表格 8×50、选项 8、字段 6，`4596-4608`）。

**视觉**：

- metric：label 12/16 次级 + value 22/28 600，tone（good/warn/bad）只改数值颜色（`6324-6329`）。
- table：`.5px` 描边 + 圆角 10 容器，表头 12px 次级色，数字列右对齐 + tabular（`6333-6338`）。
- progress：6px 轨道 + accent 填充，tone 换绿/橙/红（`6343-6351`）。
- callout：用 `color-mix(in srgb, tone 8%, transparent)` 做极淡底 + 16px 图标（`6352-6358`）。
- chart：SVG 手绘，调色板 = accent + 8 个 ink 色（`5186-5187`），支持柱/横条/折线/面积/环图，右上角菜单可「看表格 / 复制数据 / 下载图片」（`6153-6171`）。
- sources：20px 高 chip，11px 字（`6359-6362`）。

**卡片外壳复用**：只有含控件或是 raised 时才套 `bt-q` 卡片壳，纯展示型是 `bt-view-bare`（无边框、gap 8）（`6201-6225`、`6305-6306`）。

### 3.5 Secret 卡片

头部：28px Bot 头像 + 右下角小锁 + 标题（「X needs a key」/「Let X use NAME?」）+ 名字 code + 用途 + 取消按钮（`6473-6486`）。主体：掩码输入（优先 `-webkit-text-security:disc`，退化到 `type=password`）+ 作用域分段（all / 指定 Bot）（`6424-6471`）。底部固定说明：`{bot} never sees the value. It reaches {bot}'s shell as $DSH_SECRET_NAME.`，不足 4 字符时追加提示（`6541-6548`）；非 HTTPS 页面额外一条警告（`6517`）。按钮组「Replace / Cancel / Save·Allow」（`6551-6560`）。已完成的卡只留一行 + 作用域 tag + 对勾（`6563-6581`）。

### 3.6 输入区

**输入卡皮肤**（覆盖宿主 composer）：圆角 22、`.5px` 描边、min-height 44、padding 7.5、微阴影；有附件时圆角降为 18 并让附件栏独占一行（`3356-3369`）。

**左侧 `+`（ComposerPlus）**：28px 圆形、5% ink 底 + 内描边，展开时图标 rotate 45°（`3377-3381`）；菜单向上弹出（`bt-menu-up`），项为「添加文件 / 引用一段对话 / 定时任务」（`9719-9801`）。

**主按钮**：28px 圆形、accent 底、图标弹入时 `scale(.5) rotate(-30deg)`（`3389-3393`）；禁用时直接隐藏（`3394`）。

**占位文案**：宿主只给一个空 placeholder 节点，插件用 `::before { content: var(--bt-placeholder) }` 注入「Message {name}」，字号 14/24、36% ink（`3372-3374`、`9436`）。

**@ 提及菜单**：注册两个宿主 source（`ds-bot` 与 `ds-bot-chats`），前者返回当前会话可提及的 Bot（群聊只列成员）+「Everyone」（仅群且 >1 人），后者列「Chat with X」与会话引用；icon 直接用 BotMark（`9804-9888`、`9710-9717`）。会话引用编码成 `dsh-session:` + base64url，可粘贴复用（`9842-9846`）。

**语音**：麦克风 28px，按下变红并做 1.4s 的呼吸光环；语音模式是独立的 `bt-pane`，含 200px 光环球 + 转写字幕（`3396-3401`、`13313+`、`2937-2963`）。

---

## 4. 交互模式

### 4.1 @ 提及的语义与渲染

**解析**（`client.js:1884-1932`）：

- 仅识别已知 Bot 名与 `all / everyone / 所有人 / 全体`；按名字长度降序匹配，避免短名前缀抢长名（`1903`、`1920-1924`）。
- 排除代码块、行内代码、Markdown 链接内部（`LITERAL`，`1890`、`1916-1919`）。
- 排除邮箱/路径前缀（`ADDRESS_BEFORE = /[a-z0-9_./]/`）与紧随其后的标识符字符（`NAME_GOES_ON`），即 `foo@bar` 不算提及（`1888-1891`、`1907`、`1923`）。
- 命名约束：Bot 名不能含 `@`、反引号、换行，也不能叫 all/user（`1893-1900`）。

**渲染**（`1936-1946`、`2563-2564`）：`@Name` → `[Name](https://bots.local/<botId>)`；**跳过对自己的提及**（不渲染成链接）；CSS 把该链接变成无下划线、不可换行的行内单元，`::before` 用该 Bot 形状的 mask 生成 16px 头像（`DEFAULT_MASK`，`1493`）；点击事件在捕获阶段拦截并打开对应会话（`7274-7280`）。

**输入侧**：键入 `@` 由宿主唤起候选，插件提供候选项与插入值；群聊里「Everyone」只在成员 >1 时出现（`9821-9824`）。

### 4.2 群聊：顺序发言与 PASS

**两种主持模式**（`client.js:13576-13579`）：

- `admin`（Admin leads）：普通消息只发给 admin，由它用 `@Name` 点名其他人。
- `everyone`（Everyone）：所有成员按顺序各答一次，admin 先答。

**PASS 的表达**：README 说明成员无新内容时可回 `[PASS]`（`README.md:15`）。UI 把这类「没说话」的轮次渲染成事件行而不是空气泡：

- `admin-passed` → 「{name} did not answer or call anyone; call a member with @Name」（`8191-8196`）。
- `missed` → 「{name} did not answer in time」（`8188-8189`）。
- `lookup` → 「{name} looked up its own chat for …」（`8181-8186`）。
- `failed` → 「{name} could not answer: {reason}」（`8174-8179`）。

**接力上限**：房间可设 `relayLimit`（1–200，默认取 `relayLimitDefault`），超过后暂停，渲染为「Paused after N Bot relays. Waiting: A and B」+ **Continue 按钮**（`13585-13622`、`8198-8205`）。

**正在发言**：未完成时轮询 `roomProgress`（隐藏标签页降频到 5s），把 `speaking` 渲染成 `.bt-activity` 行：22px 头像（按工具切状态）+ shimmer「{name} is typing…」（`8123-8157`、`8232-8241`）。

**中断/恢复**：`resumed`（被重启打断后又接上）与 `cut`（再次被打断，放弃）两种事件行（`8206-8211`），`stopped`（你按了停止）与 `done`（自己完成）（`8224-8228`）。

### 4.3 接力与交接的 UI 表达

- **Bot 之间的消息不会出现在你的转录里**：`isRelayContext()` 识别 `source.kind==='bot'` 且非 handoff/deferred/resumed/retried 的 request/reply/stopped，配合 `relaysBefore()` 把它们折叠成步骤前的上下文（`2056-2080`）；`isHiddenTurn()` 再按 `exchangeTurns` 隐藏整轮（`2027-2030`）。
- **可见的是「状态」而不是内容**：`X started on it`、`X paused for your approval`、`X finished its work`、`X did not answer or call anyone`（`8212-8228`）。
- **左右交接（handoff）**：浏览器接管卡有标题（按 reason 映射）、说明、站点 host、三个动作 Skip / Take over / I'm done；已被你接管时显示「You control this browser」+ 呼吸点（`4168-4228`、`4245-4271`）。
- **双向提示**：发送类工具（message_bot / stop_bot / create_bot / post_to_group…）会把发送方头像切成 `sending` 状态，让「谁在跟谁说话」在侧栏可见（`3594`）。

### 4.4 卡片式人工确认

四类卡共用一套「同一时刻只有一处可交互」的架构（`client.js:8244-8245`）：

| 卡 | 触发工具 | 行内形态 | 浮层形态 | 证据 |
|---|---|---|---|---|
| 提问 | `ask_user` / `ask_user_question` | `bt-q-inline`（≤86% 宽） | `bt-q-dock`（内容宽 - 32，raised） | `4097-4126`、`3445-3447` |
| 视图 | `show_view`（含控件时） | 同上 | 同上 | `6226-6266` |
| 密钥 | `request_secret` | 同上 | `bt-q-dock` | `6583-6609` |
| 浏览器接管 | `browser_handoff` | 同上 | `bt-q-dock` | `4168-4199` |

去重逻辑：转录单元格渲染时 `noteCards(+1)`，浮层渲染时 `noteHeldCard(+1)` 并让浮层不出现；用户一旦与浮层交互（focus/pointerdown）就 `hold()` 锁定，卸载时 `-1`（`8259-8266`、`3872-3885`、`4121-4126`）。

排序：`.bt-q{order:1}` 保证卡片排在输入框的 dock 覆盖层之前（`3419-3420`）。

提交反馈：点击后立即进入 `busy`（禁用整卡），成功则整卡替换为 settled 形态或直接消失（`4097-4119`、`6226-6246`）。

### 4.5 设置页结构

- 单页列表 + 单页内容，**不是嵌套路由**；带对象 id 时进入「二级页」，头部出现返回（`16228-16234`）。
- 每页由 `SetSection`（标题 + `bt-set-card`）+ `SetRow`（左文案/提示 + 右控件）组成；卡片行之间用 `.5px` 分隔线，首末行做 12px 圆角（`2862-2871`、`15934-15943`）。
- 控件风格统一：分段（`bt-seg` + 滑动 thumb）、滑杆（accent 填充 + 16px 圆点）、开关、输入（36px 高、8 圆角）、下拉（34px）。
- 错误处理是**页内单行** `.bt-error`（12px danger），不弹 toast；`run()` 统一 catch（`16221-16227`、`2694`）。
- 底部 `bt-settings-shell` 永远贴底，作为通往宿主设置的出口（`2840`、`16263-16271`）。

### 4.6 空状态 / 加载 / 错误

**空**：

- 通用 `.bt-empty`：居中、13/18、`--bt-ink-3`、padding 8/12（`2758`）。
- 面板内：一行 `.bt-muted` 说明「This conversation is not part of your Bot team.」（`16933`）。
- 命令面板：32px 淡图标 + 14px 标签 + 13px 提示（`3049-3053`）。
- 记忆：48px 圆底图标（`3156-3160`）。
- 用量：56px 会动的鲸鱼 + 加粗主句 + 一行解释（`14593-14603`）。
- 空白会话：把宿主的 hero 区压平（隐藏标题、隐藏工作区/模式选择器），输入框仍贴底（`3314-3317`）。

**加载**：

- 骨架块：12px 高圆角条 + shimmer 背景位移（`3150-3154`）。
- 文本 shimmer：`background-clip:text` 的 60 步扫描（`3338-3340`）。
- typing 行 + 计时器（`3324-3340`）。
- 用量页 `Skeleton2()`（`14475`）。

**错误**：

- 行内错误：`.bt-error{font-size:12px;color:var(--bt-danger)}`（`2694`）。
- 事件行错误：`.bt-event-error` + `role=status` + `title=code`（`7676`）。
- 全局 toast：`ErrorToast` 6s 自动消失，附「复制诊断/反馈」入口（`15285-15310`、`15184+`）。

---

## 5. 可迁移清单（DS-Bot → Agent Console）

> 目标代码库事实：`frontend/src/app/globals.css` 已有一套 M3 深色 token（oklch，`--primary` bay blue、`--radius: 1rem`）；`console/agent-console.tsx` 是 `md:grid-cols-[76px_minmax(0,1fr)]` 两栏；`console/app-sidebar.tsx` 是 6 项图标 rail；`console/agent-portrait.tsx` 用 emoji；`chat/*` 已有气泡/输入/提及但无分组圆角、无卡片、无浮动头；`settings-page.tsx` 是路由页 + 5 个快捷入口，不是设置对话框。

### P0（先做，决定「像不像一个团队产品」）

| # | DS-Bot 做法（证据） | 目标页面/组件 | 具体改法 | 文件 |
|---|---|---|---|---|
| P0-1 | 18 变量驱动全站；三层文字、两层线、hover/active 中性叠加（`1794-1813`、`2388`） | `globals.css` 全局 | 在 `@theme inline` 之外新增一组 `--console-*` 语义变量并映射到 Tailwind：`--console-line` / `--console-line-strong`（用 `color-mix` 从 `--border` 派生）、`--console-ink-2/3`、`--console-hover/active`、`--console-msg-w`。所有卡片/行/菜单改用这套变量，不再各自写 `border-border/60` | `src/app/globals.css` |
| P0-2 | 侧栏 = 主 Bot 磁贴 + 按置顶/活跃排序的 Bot/群聊行 + 活预览 + 未读点（`8848-8924`、`8579-8684`） | `console/app-sidebar.tsx` | 把 76px rail 扩成「72px rail + 264px 团队列」（`md:grid-cols-[72px_264px_minmax(0,1fr)]`）。行高 54、圆角 10、头像 36、名字 14/20、预览 13/18 单行省略、未读 8px accent 圆点、待审批用 amber 点。预览优先级照抄：正在做 → 等待谁 → 最后一条消息 | `app-sidebar.tsx`、`agent-console.tsx`、`types/agent.ts` |
| P0-3 | 居中 40px 胶囊头，透明 header + 渐变遮罩，内容从下穿过（`2524-2546`、`3296-3299`） | `chat/chat-page.tsx` 顶部 | 用 `sticky top-0 z-20 flex justify-center` 包一个 `h-10 rounded-full border-[.5px] bg-card/80 backdrop-blur px-3.5` 胶囊：24px 头像 + 14px 名字 + 右侧箭头（`group-hover:w-4 opacity-0→100`）。其下加 `h-[60px] bg-gradient-to-b from-background to-transparent` 遮罩；滚动容器顶部 padding 60px | `chat-page.tsx`、`globals.css` |
| P0-4 | 角色形象 = 形状 + ink + 9 状态动画 + 角标（`1383-1493`、`2394-2481`、`3592-3606`） | `console/agent-portrait.tsx` | 第一阶段保留 emoji，但把容器升级为「圆形 ink 底 + emoji + `data-state` 动画 + 右下角标」：`data-state=running` 用 bob 1.6s 循环，`waiting` 用 sway，`alert` 用 hop 两次 + 12px「?」角标，`failed` 用红色描边。第二阶段再替换为 SVG 形状库（建议先移植 whale/star/moon/gumdrop 四个） | `agent-portrait.tsx`、`globals.css`、`types/agent.ts` |
| P0-5 | 气泡 18 圆角、按分组改 6、宽度变量、hover 工具条预留 82px（`2551-2553`、`2966-2989`） | `chat/message-bubble.tsx`、`message-list.tsx` | 给气泡加 `data-first` / `data-last`：首条 `rounded-tl-md`、末条 `rounded-bl-md`；`max-w-[min(var(--console-msg-w,80%),calc(100%-82px))]`；`group` + `group-hover:opacity-100` 的三按钮工具条绝对定位到 `left-full ml-1.5`；用户气泡改 `bg-primary text-primary-foreground` 并只在 hover 显示操作 | `message-bubble.tsx`、`message-list.tsx`、`globals.css` |
| P0-6 | 四类人工确认共用 `bt-q` 卡片语法 + 只出现一次（`2578-2650`、`8244-8266`） | 新增 `chat/action-card.tsx`；接入 `chat-page.tsx` | 建一个 `ActionCard`：`rounded-2xl bg-card p-3.5 shadow-[inset_0_0_0_1px_var(--console-line)]`，head（15/22 600 标题 + 13/18 说明 + 关闭）、body（选项列表）、foot（右对齐按钮）。先接「任务审批」（现 `waiting_approval`）：选项 A 批准 / B 拒绝 / C 自定义说明，键帽 24px `rounded-lg bg-secondary text-xs`。浮层版置于 composer 上方，宽度 `calc(100%-32px)`，并在行内已渲染时隐藏（用一个 Set 记「已画」） | 新增 `action-card.tsx`、`chat-page.tsx`、`hooks/use-chat.ts`、`types/chat.ts` |
| P0-7 | @ 提及 = 行内 16px 头像 chip、无下划线、点击跳会话（`1936-1946`、`2563-2564`、`7274-7280`） | `chat/message-bubble.tsx`、`lib/mention-utils.ts` | 自定义 `a` 渲染：当 `href` 以 `mention://` 开头时渲染 `inline-flex items-center gap-1 rounded-md bg-primary/10 px-1 font-medium text-primary` + 14px 头像 + 名字；点击 `router.push`。`mention-utils` 增加 `linkMentions(text, agents, selfId)`，排除代码块与邮箱前缀 | `message-bubble.tsx`、`lib/mention-utils.ts` |

### P1（第二周，决定「信息密度与专业感」）

| # | DS-Bot 做法（证据） | 目标页面/组件 | 具体改法 | 文件 |
|---|---|---|---|---|
| P1-1 | 320–520 可拖拽右面板，三视图（details/browser/side），grip 悬停显线（`2729-2737`、`16860-17012`、`17876-17918`） | `console/agent-console.tsx` | grid 增第三列 `xl:grid-cols-[72px_264px_minmax(0,1fr)_var(--console-panel-w,320px)]`；面板 `border-l-[.5px]`，左缘 8px `cursor-col-resize` 手柄，拖拽时改 CSS 变量并持久化到 localStorage；内容分「对象头（64 头像 + 可改名 + 角色）+ 分段 tab（滑块跟随）+ 详情行」 | `agent-console.tsx`、新增 `console/details-panel.tsx` |
| P1-2 | 560×402 命令面板，四段结果 + 选中片滑动（`10527-10718`、`3018-3054`） | 新增 `console/command-palette.tsx` | 全屏遮罩 + 居中 `w-[min(560px,92vw)] rounded-xl`；分组「Agent / 会话 / 命令」；行高 49、24px 头像、14/20 标题 + 12/16 副标题；↑↓/Enter/Esc；空态给图标 + 两行文案；侧栏键入任意字母即打开 | 新增 `command-palette.tsx`、`app/layout.tsx` |
| P1-3 | 时间分隔 28px、30 分钟阈值、首条用伪元素注入（`3282-3283`、`7939`、`9419-9423`） | `chat/message-list.tsx` | 在 message 之间按 `created_at` 差值 >30min 插入 `role=separator` 的居中 12px 行（`my-3.5 flex h-7 items-center justify-center text-xs text-muted-foreground`）；首条用列表容器的 `before:` 伪元素 + CSS 变量承载文案，避免额外节点 | `message-list.tsx` |
| P1-4 | 用量页：范围 tabs + 堆叠柱 + 排行行 + 热力日历 + 环形档案（`14495-14718`、`14718-14885`） | `app/settings/cost/page.tsx` | 顶部加分段范围（24h/7d/30d/12m/自定义）；主图改为按天的堆叠柱（每段用 chart-1..5）；右侧加「按 Agent / 按模型」切换；下方排行行 = 32px 字形 + 名字 + 数字 + 占比条（`h-1.5 rounded-full bg-secondary`）；底部加 53 周热力格 | `settings/cost/page.tsx`、`hooks/use-settings.ts` |
| P1-5 | 1100×780 设置对话框 + 198 导航 + 分页交错入场（`2823-2861`、`15932`、`16217-16310`） | `components/settings/settings-page.tsx` | 保留路由，但把骨架改成「左侧 198px 粘性页列表（`aria-current` 选中，圆角 8）+ 右侧内容 20px 内边距 + 20 gap」；每个 section 加 `animate-in fade-in slide-in-from-bottom-2` 且用 `style` 设 `animationDelay` 交错 30ms | `settings-page.tsx`、`app/settings/layout.tsx` |
| P1-6 | Widget：metric/table/progress/callout + 卡片壳按需（`4565-4575`、`6324-6397`、`6201-6225`） | 新增 `chat/widget-card.tsx` | 先做四种展示型：Metric（12/16 label + 22/28 600 value + tone 色）、DataTable（`.5px` 外框 + 圆角 10 + 数字右对齐 tabular）、Progress（6px 轨）、Callout（8% tint + 图标）。纯展示不套卡片，含按钮才套 | 新增 `widget-card.tsx`、`chat-page.tsx`、`types/chat.ts` |
| P1-7 | 680×760 记忆面板，17/26 标题 + 15/26 正文，条目 hover 删除并二次确认（`3118-3202`、`12216-12358`） | 新增 `console/memory-dialog.tsx` | 全屏遮罩 + `w-[min(680px,calc(100vw-48px))] h-[min(760px,calc(100vh-64px))] rounded-[20px]`；头部 60px（标题 17/24 600 + 状态 + 溢出菜单）；正文 `text-[15px] leading-[26px]`；条目 hover 才显删除，第一次点击变红底「确认删除」；底部 52px 胶囊输入 | 新增 `memory-dialog.tsx`、`app-sidebar.tsx` 入口 |
| P1-8 | 三态统一：`.bt-empty` / shimmer 骨架 / `.bt-error`（`2758`、`3150-3154`、`2694`、`3338-3340`） | 新增 `ui/feedback.tsx` | 导出 EmptyState（居中 13/18 三级文字 + 可选 48px 圆底图标）、ShimmerText（`bg-clip-text` 扫描，`motion-reduce:animate-none`）、SkeletonRows、InlineError（12px destructive，`role=alert`）。替换目前分散在各页的 `text-muted-foreground` 段落 | 新增 `ui/feedback.tsx`；各页替换 |
| P1-9 | Typing 行：28px 头像 + shimmer 动词 + 计时（`3324-3340`、`8462-8547`） | `chat/chat-page.tsx`、`hooks/use-chat.ts` | 当 `isStreaming && !hasText` 时在列表尾部渲染 `h-9 flex items-center gap-3 pl-2`：28px 头像（`data-state` 随工具切换）+ ShimmerText（「正在检索代码…」）+ tabular 计时；退场用 `animate-out fade-out zoom-out-95 duration-150` | `chat-page.tsx`、`use-chat.ts` |

### P2（打磨，决定「记得住」）

| # | DS-Bot 做法（证据） | 目标 | 改法 | 文件 |
|---|---|---|---|---|
| P2-1 | 三档动效 + 全局 reduced-motion 降级（`2400-2473`、`16136`） | 全局偏好 | 设置里加 quiet/normal/lively 三档写入 `document.documentElement.dataset.motion`；CSS 用 `[data-motion=quiet]` / `lively` 分支；所有动画补 `motion-reduce:` 变体 | `globals.css`、`settings-page.tsx` |
| P2-2 | 4 主题 × 8 键 + accent 对比度推导（`1769-1819`） | 主题设置 | 把现有暗色 token 抽成 `[data-theme=ocean|paper|mono]` 三套，每套只写 8 个值，其余由 `color-mix` 派生；accent 用同一套亮度公式算前景色 | `globals.css` |
| P2-3 | 群聊暂停/继续事件行（`8198-8205`、`13585-13622`） | `chat/chat-page.tsx` | 增加「本轮已接力 N 次，已暂停」行 + Continue 按钮；行内保留 12px 次级文字与 accent 按钮 | `chat-page.tsx`、`use-chat.ts` |
| P2-4 | 蹭头 / 戳 / 视线跟随 / fidget（`2416-2428`、`3595-3626`） | `agent-portrait.tsx` | normal 档加 `pointermove` → CSS 变量实现眼神跟随；hover 时 `rotate-6 translate-x-0.5`；点击播一次 360° 弹跳；lively 档加 5s 眨眼与 9s 摇摆 | `agent-portrait.tsx`、`globals.css` |
| P2-5 | 面板切视图时旧内容 ghost 交叉淡出 + 头像飞行（`17800-17818`、`17850-17874`） | `details-panel.tsx` | 用 View Transition 或手动 clone + `animate()` 做 160ms 的 scale(.985) 淡出；对象切换时把 24px 头像从旧位置 FLIP 到新位置 | `details-panel.tsx` |
| P2-6 | 选项 A/B/C 键盘选择 + 单卡仲裁（`3888-3921`） | `action-card.tsx` | 监听 `keydown`，忽略输入框与 `[role=dialog]`；用模块级计数器保证只有最新一张卡响应；按钮加 `aria-keyshortcuts` | `action-card.tsx` |

---

## 6. 证据索引

| 结论 | 行号区间 |
|---|---|
| 主题 8 键与四套配色 | `client.js:1767-1790` |
| 17 个 `--bt-*` 变量生成 | `client.js:1794-1822` |
| accent 前景色与暗色映射 | `client.js:1791-1792`、`1816-1819` |
| 宿主变量对齐（`--dsw-*`） | `client.js:1823-1830` |
| 全局 body 变量、暗色覆盖、19 个 ink | `client.js:2388-2393` |
| 角色形状表与渲染/缓存 | `client.js:1383-1404`、`1439-1493` |
| 身份哈希派生 | `client.js:1413-1438` |
| 状态动画 keyframes 全集 | `client.js:2431-2472` |
| 三档动效与 hover 蹭头 | `client.js:2400-2428` |
| 角标四种 | `client.js:2474-2481`、`3693-3706` |
| 群聊形象集群 | `client.js:3707-3749` |
| 侧栏顶部行 / rail | `client.js:8902-8915`、`2520-2522` |
| 侧栏排序与隐藏 | `client.js:8863-8872`、`8599`、`8658` |
| 行解剖与预览优先级 | `client.js:8624-8645`、`8573-8598` |
| 键入即搜索 | `client.js:8893-8898` |
| HeaderPill 结构与行为 | `client.js:9404-9475` |
| 浮动头 CSS 与渐变 | `client.js:3294-3299` |
| 气泡规格与分组圆角 | `client.js:2551-2553`、`2966-2989` |
| 悬停工具条与触屏降级 | `client.js:2973-2989`、`3406-3414` |
| 群消息/发言人/事件行 | `client.js:7549-7626` |
| 时间分隔与新消息分隔 | `client.js:3282-3283`、`3468-3469`、`7939` |
| typing 行 | `client.js:3324-3340`、`8462-8547` |
| 问题卡完整状态机 | `client.js:2578-2650`、`3922-4078` |
| 选项键盘仲裁 | `client.js:3888-3921` |
| Widget schema 与限制 | `client.js:4565-4608` |
| Widget 视觉规格 | `client.js:6324-6397` |
| 卡片壳按需 | `client.js:6201-6225` |
| Secret 卡 | `client.js:6424-6581` |
| 输入卡皮肤与加号菜单 | `client.js:3356-3401`、`9719-9801` |
| placeholder 注入 | `client.js:3372-3374`、`9436` |
| @ 解析与渲染 | `client.js:1884-1946`、`2563-2564`、`7274-7280` |
| @ 候选来源 | `client.js:9804-9888` |
| 群聊模式与接力上限 | `client.js:13576-13622` |
| 群回复各类事件的文案 | `client.js:8157-8241` |
| 接力上下文折叠 | `client.js:2056-2080`、`2027-2030` |
| 浏览器接管卡 | `client.js:4168-4228` |
| 卡片去重计数 | `client.js:8244-8266`、`3872-3885` |
| 设置对话框结构 | `client.js:2824-2861`、`16217-16310` |
| 设置分页表 | `client.js:15932-15933` |
| 用量页 | `client.js:14495-14718`、`14718-14885` |
| 记忆面板 | `client.js:3118-3202`、`12216-12358` |
| 面板拖拽与宽度 | `client.js:2729-2737`、`17876-17918`、`17026-17030` |
| 面板视图切换 ghost | `client.js:17800-17818` |
| 命令面板 | `client.js:10527-10718`、`3018-3054` |
| 弹簧曲线与时长 | `client.js:2181-2202` |
| 滑动/翻转/形变/退场原语 | `client.js:2251-2384` |
| 主题预览片 | `client.js:3085-3088` |
| 宿主 CSS 片段编译 | `client.js:3518-3588` |

---

## 7. 观察与警示（迁移时不要照抄的部分）

1. **它是「寄居」在宿主里的插件**，不是独立应用。为了改写宿主 DOM，作者写了一套运行时 CSS 片段编译器（把 `[class*=]` 形式的片段动态展开成宿主真实的 CSS Module 类名，`client.js:3518-3588`），并大量依赖宿主变量（`--dsh-chat-content-width`、`--dsh-content-font-size`、`--dsw-*`、`--dsh-composer-card-max-width`）。Agent Console 拥有自己的 DOM，**应该用 `data-slot` / `data-state` 暴露稳定钩子**，而不是复制这种脆弱选择器。
2. **暗色下语义色没有重映射**：`--bt-danger:#e02135` / `--bt-green:#00c972` / `--bt-star:#ff9800` 只在浅色 body 定义，暗色块（`2391`）没有覆盖，暗底上错误红的对比偏低。迁移时应为 danger/green/warn 各准备两档。
3. **类名有复用冲突**：`.bt-side` 既表示侧栏（`2490`）又被侧聊面板覆盖（`10164`），靠后写覆盖。自研时应一组件一前缀。
4. **单文件 2 万行 + 内联 CSS 模板**（`SHELL_CSS` `2387-3258`、`CONVERSATION_CSS` `3259-3508`、`WIDGET_CSS` `6304-6400`、`USAGE_CSS` `14718+`）。其中不少是「先有实现后补样式」的叠加，迁移时按 token → 原子组件 → 页面 三层重排，不要整段搬 CSS。
5. **信息密度是刻意的**：11/12px 文字、54px 行、.5px 线、82px 工具条预留，都是为「一屏看更多会话」服务。Agent Console 目前是 1rem 圆角 + 大留白的 M3 卡片风，直接套 DS-Bot 的密度会显得挤；建议**只借鉴层级与状态语法，尺寸按现有 M3 网格放大 1.15–1.25 倍**（例如 54→64 行高、13/18→14/20 预览）。
6. **动效必须能被关掉**：DS-Bot 有 36 处 reduced-motion 覆盖，且 JS 侧统一入口。迁移时每个新动画都要成对提供降级，否则在低端机与无障碍场景会成为负担。

---

*报告生成：只读分析，未修改 `E:\Agents` 下任何现有源码或文档；本文件为新增。*

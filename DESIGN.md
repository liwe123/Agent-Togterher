---
name: Agent Console
description: A dual-surface cluster console with a dark desktop deck and light mobile collaboration UI.
colors:
  operations-black: "oklch(0.105 0.012 155)"
  deck-surface: "oklch(0.145 0.013 155)"
  raised-surface: "oklch(0.18 0.015 155)"
  rule: "oklch(0.285 0.02 155)"
  signal-mint: "oklch(0.76 0.16 160)"
  signal-mint-ink: "oklch(0.14 0.025 160)"
  mobile-canvas: "oklch(0.985 0.003 250)"
  mobile-violet: "oklch(0.57 0.17 268)"
  live-green: "oklch(0.72 0.15 155)"
  warning-red: "oklch(0.65 0.2 28)"
  primary-text: "oklch(0.94 0.008 155)"
  secondary-text: "oklch(0.69 0.018 155)"
typography:
  headline:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Segoe UI Variable, Microsoft YaHei UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  data:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-mint}"
    textColor: "{colors.signal-mint-ink}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  panel:
    backgroundColor: "{colors.deck-surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: Agent Console

## 1. Overview

**Creative North Star: "The Connected Cluster Lounge"**

Agent Console 采用明确的双表面系统：桌面端像持续运行的深色集群工作台，用软件 Dock、角色群像和状态光环呈现跨 Agent 协作；移动端像原生团队通讯工具，以白色画布、清晰人物头像、自然消息气泡和底部导航降低操作成本。

两种表面共享同一信息结构和语义状态。桌面端允许运行中的头像使用局部状态光环，但拒绝全页霓虹和无意义科技装饰；移动端保持高对比、宽松行距和原生聊天节奏。

**Key Characteristics:**

- 桌面端深色绿黑底面，移动端纯净浅色画布
- 薄荷绿只标记实时连接、当前选择和运行中状态
- 圆形角色肖像是 Agent 身份识别的第一层
- 平面分区、细规则线、紧凑但可扫描的数据排版
- 桌面高密度，移动端使用原生聊天和通讯录结构

## 2. Colors

色彩模拟工业控制台的低亮表面与实体信号灯，强调色稀少且具有明确语义。

### Primary

- **Signal Mint** (`oklch(0.76 0.16 160)`): 桌面连接状态、当前导航与运行中头像光环。单屏视觉占比不超过 10%。
- **Mobile Violet** (`oklch(0.57 0.17 268)`): 移动端提及文字、当前标签和轻量主操作。

### Secondary

- **Live Green** (`oklch(0.72 0.15 155)`): 在线、运行成功和实时通道状态。
- **Warning Red** (`oklch(0.65 0.2 28)`): 失败、不可用和破坏性动作。

### Neutral

- **Operations Black** (`oklch(0.105 0.012 155)`): 桌面页面底色。
- **Deck Surface** (`oklch(0.145 0.013 155)`): 桌面主面板与侧边栏。
- **Mobile Canvas** (`oklch(0.985 0.003 250)`): 移动端背景与聊天画布。
- **Rule** (`oklch(0.285 0.02 155)`): 桌面边界；移动端使用更浅的同语义规则线。
- **Primary Text** (`oklch(0.94 0.006 70)`): 标题与主要内容。
- **Secondary Text** (`oklch(0.72 0.015 70)`): 说明、元数据和辅助标签。

**The Signal Budget Rule.** 薄荷绿只表达实时连接与运行状态；紫色只表达移动端选择和提及，两者都不用于大面积装饰背景。

## 3. Typography

**Display Font:** Segoe UI Variable（中文回退 Microsoft YaHei UI）  
**Body Font:** Segoe UI Variable（中文回退 Microsoft YaHei UI）  
**Label/Mono Font:** Cascadia Code（回退 Consolas）

**Character:** 单一人文无衬线保持产品界面熟悉而稳定；等宽字体仅用于 ID、时间、模型名、Token 与日志数据，不作为“技术感”装饰。

### Hierarchy

- **Headline** (650, 1.75rem, 1.2): 页面标题。
- **Title** (600, 1rem, 1.4): 面板和任务标题。
- **Body** (400, 0.875rem, 1.6): 描述和正文，长文本限制在 70ch 内。
- **Label** (500, 0.75rem, 1.4): 字段标签与元数据；不滥用全大写和宽字距。
- **Data** (500, 0.75rem, 1.5): 结构化数值、时间和日志。

**The Data Earns Mono Rule.** 只有可以复制、比较或按位扫描的数据使用等宽字体。

## 4. Elevation

系统默认平面化。深度来自表面明度差、1px 规则线和交互状态，不为静态卡片添加宽而柔的阴影。运行中的人物头像可以使用局部、有语义的状态光环；其他元素仍保持平整。

**The Flat Deck Rule.** 静态面板不悬浮；只有菜单、提示层等真正覆盖内容的元素获得阴影。

## 5. Components

### Buttons

- **Shape:** 8px 圆角；移动端触控高度至少 44px。
- **Primary:** 桌面使用 Signal Mint，移动端使用 Mobile Violet；只用于当前页面最重要动作。
- **Hover / Focus:** 提升明度或显示 2px 外焦点环，不使用光晕和弹跳。
- **Secondary / Ghost:** 使用规则线或透明背景，保持动作层级清晰。

### Chips

- **Style:** 状态标签使用紧凑胶囊形，但必须包含文字；筛选标签使用 8px 圆角，不伪装成状态。
- **State:** 选中筛选使用当前表面的主色边界和浅色底面，未选中保持中性。

### Cards / Containers

- **Corner Style:** 主面板 12px，内部项目 8px。
- **Background:** Deck Surface 或 Raised Surface。
- **Shadow Strategy:** 默认无阴影，以规则线和明度区分层级。
- **Border:** 1px Rule。
- **Internal Padding:** 16–24px，数据密集列表可使用 12px。

### Inputs / Fields

- **Style:** Raised Surface、8px 圆角、1px 输入边界。
- **Focus:** 当前表面的主色边界与清晰外环。
- **Error / Disabled:** 错误使用红色边界与文字；禁用态降低对比度但仍保持可读。

### Navigation

桌面端使用 76px 图标轨道，当前项由独立薄荷绿标记和高对比图标表达。移动端通讯录、控制台、任务和设置使用固定底部导航；群聊进入沉浸式页面并通过顶部返回按钮退出。

### Agent Roster

Agent 是系统核心实体。桌面群像使用大号圆形角色肖像，移动通讯录和聊天使用紧凑肖像；运行态通过头像光环、状态灯和文字共同表达。

## 6. Do's and Don'ts

### Do:

- **Do** 优先显示连接状态、任务阶段和失败恢复入口。
- **Do** 使用 `oklch` 语义变量管理颜色，并在所有页面复用同一状态含义。
- **Do** 用平面分区和 1px 规则线组织密集信息。
- **Do** 在桌面保留高信息密度，在移动端按用户工作顺序重排。
- **Do** 为加载、空状态、断线和失败提供明确说明与动作。

### Don't:

- **Don't** 使用紫蓝渐变、玻璃拟态或无业务含义的光晕；只有运行中头像可以出现状态光环。
- **Don't** 把所有内容包装成同尺寸圆角卡片或嵌套卡片。
- **Don't** 使用游戏化 HUD、伪终端字符雨或无意义装饰网格。
- **Don't** 使用营销页英雄指标、巨大标题或装饰性统计数字。
- **Don't** 只靠颜色表达状态，或用低对比灰字换取“高级感”。
- **Don't** 使用大于 1px 的侧边彩条或渐变文字。

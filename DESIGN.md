---
name: Agent Console
description: A calm operations desk for multi-agent work.
colors:
  operations-black: "oklch(0.125 0.012 70)"
  deck-surface: "oklch(0.16 0.013 70)"
  raised-surface: "oklch(0.195 0.014 70)"
  rule: "oklch(0.31 0.018 70)"
  signal-amber: "oklch(0.76 0.16 65)"
  signal-amber-ink: "oklch(0.18 0.03 65)"
  live-green: "oklch(0.72 0.15 155)"
  warning-red: "oklch(0.65 0.2 28)"
  primary-text: "oklch(0.94 0.006 70)"
  secondary-text: "oklch(0.72 0.015 70)"
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
    backgroundColor: "{colors.signal-amber}"
    textColor: "{colors.signal-amber-ink}"
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

**Creative North Star: "The Quiet Flight Desk"**

Agent Console 像一张持续工作的任务调度桌：稳定的深色底面承载高密度信息，少量信号琥珀标记当前选择与需要注意的操作，绿色、黄色和红色仅用于真实运行状态。页面保持平整、克制和结构化，依靠对齐、层级与细边界建立秩序。

系统拒绝通用 AI 产品的紫蓝渐变与霓虹光效，也拒绝把每条数据都做成悬浮卡片。它应让熟悉 Linear、Raycast 或现代可观测性工具的用户直接进入工作，不必重新学习装饰性操作方式。

**Key Characteristics:**

- 深色暖石墨底面，低反光、长时间查看不刺眼
- 琥珀色只标记选择、主操作和关键编号
- 平面分区、细规则线、紧凑但可扫描的数据排版
- 状态始终同时具备颜色、图标和文字
- 桌面高密度，移动端按任务顺序重排而非简单缩小

## 2. Colors

色彩模拟工业控制台的低亮表面与实体信号灯，强调色稀少且具有明确语义。

### Primary

- **Signal Amber** (`oklch(0.76 0.16 65)`): 当前导航、选中筛选、主按钮和关键编号。单屏视觉占比不超过 10%。

### Secondary

- **Live Green** (`oklch(0.72 0.15 155)`): 在线、运行成功和实时通道状态。
- **Warning Red** (`oklch(0.65 0.2 28)`): 失败、不可用和破坏性动作。

### Neutral

- **Operations Black** (`oklch(0.125 0.012 70)`): 页面底色。
- **Deck Surface** (`oklch(0.16 0.013 70)`): 主面板与侧边栏。
- **Raised Surface** (`oklch(0.195 0.014 70)`): 输入框、悬停和次级分区。
- **Rule** (`oklch(0.31 0.018 70)`): 边界和分隔线。
- **Primary Text** (`oklch(0.94 0.006 70)`): 标题与主要内容。
- **Secondary Text** (`oklch(0.72 0.015 70)`): 说明、元数据和辅助标签。

**The Signal Budget Rule.** 琥珀色只表达“现在看这里或在这里操作”，不用于装饰背景。

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

系统默认平面化。深度来自表面明度差、1px 规则线和交互状态，不为静态卡片添加宽而柔的阴影。悬停最多使用局部亮度变化与 1px 位移；焦点使用清晰的琥珀或状态色轮廓。

**The Flat Deck Rule.** 静态面板不悬浮；只有菜单、提示层等真正覆盖内容的元素获得阴影。

## 5. Components

### Buttons

- **Shape:** 8px 圆角；移动端触控高度至少 44px。
- **Primary:** Signal Amber 背景配深色文字，只用于当前页面最重要动作。
- **Hover / Focus:** 提升明度或显示 2px 外焦点环，不使用光晕和弹跳。
- **Secondary / Ghost:** 使用规则线或透明背景，保持动作层级清晰。

### Chips

- **Style:** 状态标签使用紧凑胶囊形，但必须包含文字；筛选标签使用 8px 圆角，不伪装成状态。
- **State:** 选中筛选使用琥珀色边界和浅色底面，未选中保持中性。

### Cards / Containers

- **Corner Style:** 主面板 12px，内部项目 8px。
- **Background:** Deck Surface 或 Raised Surface。
- **Shadow Strategy:** 默认无阴影，以规则线和明度区分层级。
- **Border:** 1px Rule。
- **Internal Padding:** 16–24px，数据密集列表可使用 12px。

### Inputs / Fields

- **Style:** Raised Surface、8px 圆角、1px 输入边界。
- **Focus:** Signal Amber 边界与清晰外环。
- **Error / Disabled:** 错误使用红色边界与文字；禁用态降低对比度但仍保持可读。

### Navigation

侧边栏保持固定工具形态；当前项使用琥珀色小型标记和高对比文本，不使用大面积彩色胶囊。移动端转为顶部紧凑导航，所有核心路由仍可横向访问。

### Agent Roster

Agent 是系统核心实体。头像、名称、角色、状态和模型绑定保持同一阅读顺序；运行态变化通过状态灯、文字和轻量表面变化共同表达。

## 6. Do's and Don'ts

### Do:

- **Do** 优先显示连接状态、任务阶段和失败恢复入口。
- **Do** 使用 `oklch` 语义变量管理颜色，并在所有页面复用同一状态含义。
- **Do** 用平面分区和 1px 规则线组织密集信息。
- **Do** 在桌面保留高信息密度，在移动端按用户工作顺序重排。
- **Do** 为加载、空状态、断线和失败提供明确说明与动作。

### Don't:

- **Don't** 使用紫蓝渐变、霓虹描边、玻璃拟态或无业务含义的光晕。
- **Don't** 把所有内容包装成同尺寸圆角卡片或嵌套卡片。
- **Don't** 使用游戏化 HUD、伪终端字符雨或无意义装饰网格。
- **Don't** 使用营销页英雄指标、巨大标题或装饰性统计数字。
- **Don't** 只靠颜色表达状态，或用低对比灰字换取“高级感”。
- **Don't** 使用大于 1px 的侧边彩条或渐变文字。

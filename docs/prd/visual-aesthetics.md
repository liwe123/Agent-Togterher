# PRD：前端视觉与响应式优化（含 /contacts 通讯录页）

> 类型：新需求（Requirement）｜状态：已实施｜关联提交：`9c2dd0e`（C-005）+ 并入 `0c46b78`（C-021）

---

## 1. 背景与问题

MVP 功能齐全，但视觉与体验未达「可对外展示」标准：

1. **桌面端观感粗糙**：色板、间距、卡片缺乏统一视觉令牌，状态表达依赖颜色单通道，违背「技术感来自结构」的产品定位。
2. **移动端不可用**：布局非响应式，聊天/任务/设置在小屏上溢出或拥挤；PRODUCT.md 要求移动端像原生团队聊天。
3. **缺少 Agent 目录**：用户无法一眼看到工作区有哪些 Agent、各自职责与在线状态。
4. **Agent 无人像**：角色只以文字/色块出现，缺少 `agent-portrait` 头像组件承载状态光环。

### 本轮要解决的问题
1. 建立统一视觉令牌（oklch 色板、间距、圆角、字体分级）并全站响应式。
2. 新增 `/contacts` 通讯录页：Agent 实名目录 + 职责 + 在线状态 + 搜索。
3. 新增 `agent-portrait` 头像组件（语义状态光环）。
4. 重构聊天/任务/控制台/设置各组件，符合 PRODUCT.md 设计原则与 WCAG 2.1 AA。
5. 桌面端深色集群台 + 移动端浅色原生聊天的双表面系统（DESIGN.md）。

## 2. 目标与非目标

**目标**
- G1：`globals.css` 建立语义令牌（深色暖石墨底、信号琥珀强调、状态三重表达：颜色+图标+文字），并实现断点级响应式。
- G2：新增 `/contacts` 通讯录页与 `agent-portrait` 头像组件。
- G3：重构 agent-gallery / status-panel / app-sidebar / chat 系组件，遵循统一视觉语法。
- G4：桌面与移动双表面：桌面深色运控台，移动浅色原生聊天节奏。
- G5：与既有功能（API Key 管理、自定义模型）共存，不破坏设置页功能。

**非目标（N1-N3）**
- N1：不做全新信息架构/路由重构（仅视觉与组件级调整）。
- N2：不做动画框架引入（仅 CSS transition / prefers-reduced-motion 降级）。
- N3：不改变 WebSocket 事件契约与后端 API。

## 3. 用户故事

- US1：作为用户，我在桌面端看到一套统一的深色运控台：一致的卡片、间距、语义色，状态灯能反映 Agent 运行状态。
- US2：作为用户，我在手机上打开 /chats、/tasks、/settings，布局自适应、触控目标 ≥44px，像原生聊天工具一样顺畅。
- US3：作为用户，我打开 `/contacts` 通讯录，看到 6 个 Agent 的实名、职责与在线状态，输入姓名/职责可搜索。

## 4. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | `globals.css` 视觉令牌：oklch 色板（deck-surface/raised-surface/rule/signal-mint…）、间距/圆角/字体分级（Segoe UI Variable / Microsoft YaHei UI；数据用 Cascadia Code） | P0 |
| FR2 | 响应式布局：`console-shell` 侧栏 `md:grid-cols-[76px_1fr]`，内容区 `px-4→xl:px-10` 渐变；聊天/任务/设置组件在 sm/md/lg/xl 断点自适应 | P0 |
| FR3 | 新增 `/contacts` 路由 + `contacts-page.tsx`：Agent 实名目录、角色职责描述、在线状态、搜索过滤（姓名/角色） | P0 |
| FR4 | 新增 `agent-portrait` 头像组件：首字母/图标 + 语义状态光环（仅运行中允许局部光环） | P0 |
| FR5 | 重构组件统一视觉：agent-gallery（角色群像）、status-panel（状态面板）、app-sidebar（侧栏）、chat-composer（输入器）、message-bubble（气泡）、task-detail/status-badge | P0 |
| FR6 | 状态三重表达：颜色 + 图标 + 文字（不单靠颜色），低对比灰字退回 `text-foreground` | P0 |
| FR7 | 设置页并入视觉样式，保留 API Key 管理 + 自定义模型功能（C-021 手工合并 1 处文本冲突） | P0 |
| FR8 | 异常可恢复：加载/空/断线/失败态均有说明与下一步操作 | P1 |

## 5. 非功能需求（NFR）

- **可访问性**：WCAG 2.1 AA 基线；正文与占位文字对比度 ≥ 4.5:1；移动触控目标 ≥ 44px；键盘操作与清晰焦点态；`prefers-reduced-motion` 降级。
- **一致性**：同一动作同一形状——导航、筛选、按钮、状态与数据字段全站统一视觉语法（DESIGN.md 原则 3）。
- **反模式约束**：避免紫蓝渐变、玻璃拟态、卡片墙、伪终端雨、营销大标题（PRODUCT.md Anti-references）。
- **不回归**：视觉重构不得改变功能与数据流；lint/test/build 全过。

## 6. 验收标准（AC）

- AC1：桌面端（≥md）为深色运控台，移动端（<md）布局自适应、无横向溢出；聊天/任务/设置/通讯录四页在 375/768/1280 宽度下均可浏览操作。
- AC2：`/contacts` 显示全部 Agent：实名 + 职责 + 在线状态灯；搜索可按姓名或职责过滤。
- AC3：Agent 头像带状态光环，颜色与文字/图标共同表达状态（不单靠颜色）。
- AC4：设置页视觉采用新样式，且 API Key 管理、自定义模型功能完好（回归通过）。
- AC5：`npm run lint && npm test && npm run build` 全过；后端 pytest 42 passed。
- AC6：A/B 对比通过后并入主分支（C-021 合并记录），仅 settings-page.tsx 1 处文本冲突手工合并。

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1 | globals.css 令牌 + 响应式基础 | 视觉基座 |
| M2 | agent-portrait + /contacts 通讯录页 | 目录 + 头像 |
| M3 | 聊天/任务/控制台/设置组件重构 | 全站统一 |
| M4 | A/B 对比验证并入主分支 + 设置页功能共存 | 验收 AC1-AC6 |

## 8. 变更追踪登记

| 改动时间 | ID | 状态 | Git 提交 | 作者 | 改动类型 | 影响范围 | 改动内容 | 前端技术 | 后端技术 | 是否有数据库 | 破坏性变更 | 验证结果 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-01 20:55 | C-005 | 已完成 | [9c2dd0e](https://github.com/liwe123/Agent-Togterher/commit/9c2dd0e) | LI | Requirement | 其他、配置、文档、前端 | 前端视觉与响应式优化，新增通讯录 /contacts 页面与 Agent 头像组件 | 新增 agent-portrait.tsx、contacts-page.tsx(/contacts 路由)；agent-gallery/status-panel/app-sidebar/chat 组件重构；globals.css 视觉令牌与响应式优化 | - | 否 | 否 | - | 1203 插入/471 删除，21 文件；经 C-021 并入当前分支 |
| 2026-08-03 14:36 | C-021 | 已完成 | [0c46b78](https://github.com/liwe123/Agent-Togterher/commit/0c46b78) | LI | Requirement | 其他 | 合并视觉重构提交 9c2dd0e（A/B 测试通过）：新增 /contacts 通讯录页、agent-portrait 头像组件、恢复 software-dock；globals.css 视觉与响应式优化；设置页与 API Key/自定义模型功能共存 | 合并 settings-page.tsx（保留 API Key 管理 + 自定义模型功能并采用视觉样式）；新增 contacts 路由、agent-portrait.tsx、software-dock.tsx 恢复；agent-gallery/status-panel/app-sidebar/chat 视觉重构 | - | 否 | 否 | lint/test/build/pytest 全过(42) | 仅 settings-page.tsx 1 处文本冲突手工合并 |

---

## 9. 已实施摘要（实施部分）

**关键文件**
- 新增：`frontend/src/components/console/agent-portrait.tsx`、`frontend/src/components/contacts/contacts-page.tsx`、`frontend/src/app/contacts/page.tsx`
- 修改：`frontend/src/app/globals.css`（令牌 + 响应式）、`frontend/src/components/console/agent-gallery.tsx` / `status-panel.tsx` / `app-sidebar.tsx` / `software-dock.tsx`、`frontend/src/components/chat/chat-composer.tsx` / `message-bubble.tsx` / `chat-page.tsx`、`frontend/src/components/tasks/*`、`frontend/src/components/settings/settings-page.tsx`
- 设计：`.impeccable/design.json`、`DESIGN.md`（双表面系统）

**验证结果**：1203 插入 / 471 删除，21 文件；lint/test/build + pytest(42) 全过；A/B 对比通过后并入主分支。

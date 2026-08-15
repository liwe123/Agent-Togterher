# PRD：成本统计面板

> 类型：Requirement ｜ 状态：进行中 ｜ 工单 ID：C-106

---

## 1. 目标与背景

随着企业在 Agent Console 中引入多智能体协同（Orchestrator、Manager、Worker、Reviewer）处理复杂任务，大模型 API 调用量和 Token 消耗快速增长。为了帮助企业管理者洞察算力消耗、控制预算并识别高消耗异常任务，必须建立统一的多维成本中心与 Token 分析看板。

### 核心目标 (Goals)
- **G1（成本全局感知）**：实时展示本月总支出、今日支出、总 Token 消耗与端到端平均响应延迟。
- **G2（多维消耗分析）**：提供近 30 天每日费用与 Token 波动趋势图，支持按模型厂商（DeepSeek、OpenAI、Anthropic、Gemini）展示占比。
- **G3（Top 消耗排查）**：按累计消耗金额倒序展示 Top 任务排行，并支持一键跳转任务轨迹深度回溯。
- **G4（工作区租户隔离）**：各租户仅能查看自身工作区的算力与费用统计。
- **G5（极致性能）**：通过数据库联合索引与预聚合查询，毫秒级响应仪表盘数据。

---

## 2. 用户故事 (User Stories)

- **US1（企业预算管控）**：作为团队管理者，我需要查看本月累计支出与近 30 天每日消耗趋势，以便做好模型预算规划。
- **US2（模型选型优化）**：作为 AI 架构师，我需要分析各模型的费用占比与 Token 消耗，以便针对高频场景采用性价比更高的模型。
- **US3（高耗异常排查）**：作为运维人员，当系统产生异常费用时，我能通过 Top 任务榜单快速定位是哪次任务引发了大量的 Token 循环调用。

---

## 3. 功能需求 (Functional Requirements)

| 编号 | 需求项 | 详细描述 | 优先级 |
|---|---|---|---|
| **FR1** | 核心汇总指标 API | 提供 `GET /api/v1/workspaces/{id}/cost/summary`，返回本月支出、今日支出、累计总费用、总 Token、调用总次数及平均延迟 | P0 |
| **FR2** | 每日消耗趋势 API | 提供 `GET /api/v1/workspaces/{id}/cost/daily-trend?days=30`，返回每日 Prompt/Completion Token 与费用序列 | P0 |
| **FR3** | 模型占比分布 API | 提供 `GET /api/v1/workspaces/{id}/cost/by-model`，按模型聚合费用、调用量、Token 数与支出百分比 | P0 |
| **FR4** | Top 任务排行 API | 提供 `GET /api/v1/workspaces/{id}/cost/top-tasks?limit=10`，关联 Task 与 ModelCall 按费用倒序排列 | P0 |
| **FR5** | 前端成本仪表盘 | 新增 `/settings/cost` 路由，展示 4 张核心指标卡片、每日趋势 SVG 柱状图、模型进度条占比与任务排行表 | P0 |
| **FR6** | 时间周期切换 | 支持快速切换近 7 天与近 30 天消耗趋势视图 | P1 |
| **FR7** | 任务深度跳转 | Top 任务表格支持直接点击任务 ID 跳转至 `/tasks/[id]` 执行回溯详情页 | P1 |
| **FR8** | 导航快捷集成 | 在 `/settings` 设置中心主页挂载「成本中心与 Token 分析」卡片 | P1 |

---

## 4. 后端 API 规范

### 1. `GET /api/v1/workspaces/{workspace_id}/cost/summary`
- **响应体**：
```json
{
  "success": true,
  "data": {
    "total_cost_usd": 0.124500,
    "today_cost_usd": 0.005200,
    "month_cost_usd": 0.089000,
    "total_tokens": 125000,
    "total_calls": 45,
    "avg_latency_ms": 680.5
  }
}
```

### 2. `GET /api/v1/workspaces/{workspace_id}/cost/daily-trend`
- **响应体**：
```json
{
  "success": true,
  "data": [
    {
      "date": "2026-08-15",
      "prompt_tokens": 8000,
      "completion_tokens": 2500,
      "total_tokens": 10500,
      "cost_usd": 0.012500,
      "call_count": 12
    }
  ]
}
```

---

## 5. 验收标准 (Acceptance Criteria)

- **AC1**：当任务产生 `model_calls` 记录后，`/cost/summary`、`/cost/daily-trend`、`/cost/by-model` 与 `/cost/top-tasks` 能够准确完成多维聚合。
- **AC2**：在 `/settings/cost` 页面中，4 个核心指标卡片、趋势图表、模型分布与 Top 任务列表渲染正常。
- **AC3**：支持在近 7 天与近 30 天之间无缝切换，图表高度自适应缩放。
- **AC4**：点击 Top 任务 ID 成功导航至 `/tasks/[id]` 任务详情页面。
- **AC5**：单元测试 `test_cost.py` 与全量测试套件通过率 100%。
- **AC6**：前端 `npm run lint` 0 错误 0 警告，`npm run build` 成功。

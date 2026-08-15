# PRD：工作区配额与限流治理

> 类型：Requirement ｜ 状态：已完成 ｜ 工单 ID：C-109

---

## 1. 目标与背景

随着企业内多个团队和部门共享 Agent Console 平台，如果不加限制地并发提交大模型任务，可能导致平台算力超载、触发厂商 Rate Limit，甚至产生高昂的意外账单。系统必须提供精细化的多租户工作区配额管控能力，支持配置月度消费预算、Token 限额、最大并发任务数与请求限流规则，并提供超额硬熔断保护。

### 核心目标 (Goals)
- **G1（月度预算管控）**：支持按工作区设定月度美元支出限额与 Token 阈值。
- **G2（实时水位预警）**：计算当月已消耗金额与预算百分比，提供三色渐变消耗进度条。
- **G3（硬熔断机制）**：支持开启「硬熔断保护」，当预算用尽时拒绝新建任务。
- **G4（并发与限流治理）**：限制单工作区最大并发 Running 任务数与每分钟 API 请求速率。
- **G5（权限隔离）**：普通成员可查看当前工作区配额水位，仅 Owner/Admin 具备修改配额权限。

---

## 2. 用户故事 (User Stories)

- **US1（企业财务风控）**：作为企业 IT 管理员，我为「市场部工作区」分配了 200 美元/月的额度，并开启硬熔断，确保绝对不会超额支出。
- **US2（开发者算力感知）**：作为普通团队成员，我在提交大型多 Agent 协同任务前，可以到 `/settings/quota` 查看本月还剩多少额度可用。
- **US3（高并发保护）**：作为运维人员，我通过设置最大并发任务数为 5，防止某个用户一次性并发提交 50 个复杂任务挤占调度 Worker。

---

## 3. 功能需求 (Functional Requirements)

| 编号 | 需求项 | 详细描述 | 优先级 |
|---|---|---|---|
| **FR1** | 配额数据模型 | 新增 `quota_configs` 表，持久化存储月度预算、Token 上限、并发数与熔断开关 | P0 |
| **FR2** | 配额查询接口 | 提供 `GET /api/v1/workspaces/{id}/quota`，返回当月支出金额、Token 消耗、使用百分比与超额标识 | P0 |
| **FR3** | 配额更新接口 | 提供 `PUT /api/v1/workspaces/{id}/quota`，支持 Admin 更新配额参数并记录审计日志 | P0 |
| **FR4** | 前端配额控制台 | 新增 `/settings/quota` 页面，展示水位进度条、各项数值表单与保存按钮 | P0 |
| **FR5** | 熔断状态提示 | 当工作区超额时，在控制台弹出显式风险警示横幅 | P0 |
| **FR6** | 设置中心导航 | 在 `/settings` 主页快捷导航网格中加入「配额与限流」卡片 | P1 |
| **FR7** | 权限控制 | 仅 Admin 与 Owner 角色可提交配额保存表单，非管理员输入框禁用 | P0 |
| **FR8** | 审计日志集成 | 配额配置变更自动写入 `quota.update` 审计日志流 | P1 |

---

## 4. 数据模型设计

```sql
CREATE TABLE quota_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    monthly_budget_usd FLOAT DEFAULT 100.0,
    max_monthly_tokens INTEGER DEFAULT 10000000,
    max_concurrent_tasks INTEGER DEFAULT 5,
    rate_limit_per_minute INTEGER DEFAULT 60,
    is_hard_limit BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ix_quota_configs_workspace_id ON quota_configs(workspace_id);
```

---

## 5. 后端 API 规范

### `GET /api/v1/workspaces/{workspace_id}/quota`
- **响应体**：
```json
{
  "success": true,
  "data": {
    "workspace_id": 1,
    "monthly_spent_usd": 12.500000,
    "monthly_tokens_used": 450000,
    "budget_usd": 100.0,
    "token_limit": 10000000,
    "max_concurrent_tasks": 5,
    "is_hard_limit": true,
    "percent_spent": 12.5,
    "is_exceeded": false
  }
}
```

---

## 6. 验收标准 (Acceptance Criteria)

- **AC1**：调用 `GET /quota` 接口能够正确返回工作区当月支出、预算总额与使用百分比。
- **AC2**：调用 `PUT /quota` 接口能够成功持久化新的预算和熔断开关，并写入审计日志。
- **AC3**：在 `/settings/quota` 页面中，水位条根据百分比呈现正常/警告/危险颜色。
- **AC4**：非 Admin 角色访问 `/settings/quota` 时表单处于禁用状态。
- **AC5**：单元测试 `test_quota.py` 与全量测试套件通过率 100%。
- **AC6**：前端 `npm run lint` 0 错误 0 警告，`npm run build` 成功。

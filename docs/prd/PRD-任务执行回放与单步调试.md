# PRD：任务执行回放与单步调试

> 类型：Requirement ｜ 状态：进行中 ｜ 工单 ID：C-108

---

## 1. 目标与背景

在复杂的多智能体协同任务（Orchestrator 任务拆解 -> 多 Worker 执行 -> Reviewer 代码审核 -> Manager 总结）中，任务往往包含多个阶段与数十次模型及工具调用。当任务失败、超时或产出不如预期时，开发者与运维人员需要一种类似「录像带」的机制，能够单步查看每一步的输入输出 Payload、模型耗费与调用链路，并支持从失败断点节点直接恢复执行，而无需全量重新运行。

### 核心目标 (Goals)
- **G1（全轨迹时序流）**：按执行时间先后顺序输出带有单步耗时、Token 与费用的结构化回放帧（Replay Frames）。
- **G2（单步交互播放器）**：提供播放/暂停、1x/2x/5x 倍速切换与时间轴进度拖拽回放能力。
- **G3（输入输出深度排查）**：可视化检查每个步骤的 Input / Output Payload，快速定位 Prompt 偏差。
- **G4（断点恢复执行）**：针对失败步骤，支持「从此步骤恢复执行」，继承前序步骤成功上下文重新入队调度。
- **G5（只读防篡改）**：回放数据基于 `task_steps` 与 `model_calls` 事实源，保证轨迹真实性。

---

## 2. 用户故事 (User Stories)

- **US1（调试多智能体协作）**：作为算法工程师，当任务在「测试专员审核」步骤被拒绝时，我可以通过回放查看该步骤的审核反馈 Payload，定位 Worker 产出的代码缺陷。
- **US2（低成本断点重试）**：作为用户，当长流水线任务在最后一步发生网络偶发超时时，我能一键从最后一步重试，避免重跑前序耗时耗费的步骤。
- **US3（演示与复盘）**：作为团队负责人，我可以通过倍速播放器向客户清晰演示 Agent 是如何一步步拆解并完成复杂任务的。

---

## 3. 功能需求 (Functional Requirements)

| 编号 | 需求项 | 详细描述 | 优先级 |
|---|---|---|---|
| **FR1** | 任务回放 API | 提供 `GET /api/v1/tasks/{id}/replay`，聚合 TaskSteps 与 ModelCalls 生成时序帧列表 | P0 |
| **FR2** | 断点恢复 API | 提供 `POST /api/v1/tasks/{id}/resume-from-step`，支持重置指定步骤状态并唤醒调度 | P0 |
| **FR3** | 回放播放器组件 | 前端 `TaskReplayPlayer`，提供播放/暂停、倍速调节与时间轴 scrub bar | P0 |
| **FR4** | 步骤状态高亮 | 播放过程中实时高亮当前帧状态（进行中/已完成/失败），同步展示该步耗时与费用 | P0 |
| **FR5** | Payload 详情检查器 | 左右分栏展示当前步骤输入与输出 JSON 结构，支持滚动与格式化预览 | P0 |
| **FR6** | 异常步骤重试按钮 | 若当前帧状态为 `failed`，展示明显的「从此步恢复」操作按钮并联动后端刷新 | P0 |
| **FR7** | 任务详情页嵌入 | 在 `/tasks/[id]` 页面核心区域内嵌展示 `TaskReplayPlayer` | P1 |
| **FR8** | 审计日志联动 | 从断点步骤恢复任务时，自动写入 `task.resume_step` 审计日志 | P1 |

---

## 4. 后端 API 规范

### 1. `GET /api/v1/tasks/{task_id}/replay`
- **响应体**：
```json
{
  "success": true,
  "data": {
    "task_id": 12,
    "title": "重构前端侧边栏组件",
    "status": "completed",
    "total_duration_ms": 3500,
    "total_cost_usd": 0.008500,
    "frames": [
      {
        "step_id": 1,
        "step_name": "manager_plan",
        "agent_role": "manager",
        "status": "completed",
        "started_at": "2026-08-15T15:00:00Z",
        "completed_at": "2026-08-15T15:00:01Z",
        "duration_ms": 1000,
        "input_payload": { "prompt": "重构前端侧边栏组件" },
        "output_payload": { "plan": ["analysis", "code_gen"] },
        "error_message": null,
        "model_calls_count": 1,
        "tokens_used": 1500,
        "cost_usd": 0.003000
      }
    ]
  }
}
```

### 2. `POST /api/v1/tasks/{task_id}/resume-from-step`
- **请求体**：
```json
{
  "step_id": 2,
  "custom_instruction": "修复网络异常后重新发起"
}
```

---

## 5. 验收标准 (Acceptance Criteria)

- **AC1**：访问 `/api/v1/tasks/{id}/replay` 返回结构化 `frames` 数组，时间排序正确。
- **AC2**：在 `/tasks/[id]` 页面中，`TaskReplayPlayer` 能够正常点击播放并按 1x/2x/5x 自动步进。
- **AC3**：点击时间轴上各数字圆点可精准跳转到对应步骤帧并更新 Payload 视窗。
- **AC4**：对于失败步骤，点击「从此步恢复」后任务状态与步骤状态成功恢复为 `pending`。
- **AC5**：单元测试 `test_task_replay.py` 与全量测试套件通过率 100%。
- **AC6**：前端 `npm run lint` 0 错误 0 警告，`npm run build` 成功。

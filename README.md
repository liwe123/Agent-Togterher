# Agent Console

<h4 align="center">寂静飞控台 · The Quiet Flight Desk</h4>

<p align="center">
  <strong>多智能体不再散落各处。一张深色运控台，看见全局，精准调度。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-MVP-oklch(0.76%200.16%2065)?style=flat" alt="MVP">
  <img src="https://img.shields.io/badge/python-3.11+-blue?style=flat" alt="Python">
  <img src="https://img.shields.io/badge/next-16-black?style=flat" alt="Next.js">
  <img src="https://img.shields.io/badge/tests-37%20%2B%2028%20passing-oklch(0.72%200.15%20155)?style=flat" alt="Tests">
  <img src="https://img.shields.io/badge/license-TBD-lightgrey?style=flat" alt="License">
</p>

---

## 这是什么

一个**本地优先的多 Agent 运控台** — 不是聊天玩具，不是 Demo 花架子。

你打字，Agent 干活。Manager 拆任务，Worker 各自执行，QA 审核，最后汇总。
全程可视：每一步执行、每一次模型调用、每一次降级切换，全在 WebSocket 实时
推到你面前。

```
你: "重构订单模块并更新前端页面" @项目总设计师
      │
      ▼
Manager 拆解 ──→ Worker 1: Agent工程师  ──→ Worker 2: 前端设计师
      │                    │                        │
      ▼                    ▼                        ▼
QA 审核 ←──────────────────────────────────────────┘
      │
      ▼
Manager 汇总 ──→ 最终结果回到群聊
```

## 架构

```
┌─────────────────────────────────────────────┐
│  Browser (Next.js 16 · React 19 · Tailwind) │
│  ┌─────────┐ ┌──────┐ ┌──────┐ ┌─────────┐ │
│  │ 运行总览 │ │ 群聊  │ │ 任务 │ │ 模型设置 │ │
│  └─────────┘ └──────┘ └──────┘ └─────────┘ │
│        ▲          ▲         ▲         ▲      │
│        └──────────┼─────────┼─────────┘      │
│                   │ WS live sync             │
└───────────────────┼─────────────────────────┘
                    │
┌───────────────────┼─────────────────────────┐
│  FastAPI Backend  │                          │
│  ┌──────────┐ ┌───┴──────┐ ┌─────────────┐  │
│  │MessageHub│ │Orchestrator│ │WebSocket Mgr│  │
│  └──────────┘ └────┬──────┘ └─────────────┘  │
│                    │                          │
│  ┌─────────────────┼──────────────────────┐  │
│  │ LiteLLM (gpt-4.1 → deepseek → qwen ↓)  │  │
│  └────────────────────────────────────────┘  │
│  ┌──────────┐                               │
│  │  SQLite  │  (PostgreSQL 就等一条命令)     │
│  └──────────┘                               │
└─────────────────────────────────────────────┘
```

## 六人 Agent 编队

| Agent | 角色 | 绑定模型 |
| --- | --- | --- |
| 项目总设计师 | 拆解任务 / 最终汇总 | `manager_model` |
| Agent 工程师 | 后端逻辑实现 | `code_model` |
| 前端设计师 | 前端页面实现 | `code_model` |
| 知识库管理员 | 长文写作与整理 | `writing_model` |
| 测试专员 | QA 审核 | `review_model` |
| 运维 | 部署与运维 | `code_model` |

每个 Agent 有自己的 system prompt，模型可独立配置。`config/models.yaml` 定义
了降级链 — 主 Provider 挂了自动切备用，切成功了会标 `fallback_used: true`。

## 设计哲学

深色暖石墨底，信号琥珀只标记"现在看这里"。没有紫蓝渐变，没有霓虹描边，
没有玻璃拟态。状态始终用颜色 + 图标 + 文字三重表达。

> *"技术感来自结构，不来自装饰。"*

更多细节见 [DESIGN.md](DESIGN.md)。

## 事件总线

一个 WebSocket 连接，六种事件，按工作区隔离：

```
ws://localhost:8000/ws/workspaces/{id}

message.created       → 消息气泡实时出现
task.status_changed   → 任务徽章变色
task.step_changed     → 步骤时间线推进
agent.status_changed  → Agent 状态灯切换
model.call_finished   → 模型调用日志追加
error                 → 错误横幅弹出
```

前端 4 个 Hook（`useChat`、`useTasks`、`useAgentConsole`、`useSettings`）
共用同一个 `useWorkspaceSocket`，3 秒断线自动重连，事件合并逻辑全部去重到
`lib/task-utils.ts`。

## 一分钟跑起来

```powershell
Copy-Item .env.example .env
docker compose up --build
```

- 前端 → http://localhost:3000
- API 文档 → http://localhost:8000/docs
- 健康检查 → http://localhost:8000/api/v1/health

打开浏览器，默认工作区和 6 个 Agent 已就位。输入 `@项目总设计师 帮我...` 回车。

## 质量基线

| 项 | 状态 |
| --- | --- |
| 后端 pytest | 37 passed |
| 前端 Node test | 28 passed |
| ESLint | 0 errors / 0 warnings |
| TypeScript + Next build | 编译通过 |
| 失败恢复 | 进程重启自动恢复未完成任务 |
| 失败持久化 | 主 Session 坏了用 fallback Session 补刀 |
| 并发控制 | 单工作区最多 3 个进行中任务，超了 429 |

## 关键决策记录

**为什么 `asyncio.create_task` 而不是 Celery？**
MVP 阶段不值得引入消息队列的运维复杂度。`run_task(task_id)` 入口已经设计为
无状态函数 — 未来加一行 `celery_app.send_task("run_task", args=[task_id])`
即可切换。`orchestrator.py` 里也标了 `asyncio.gather` 并行化的 TODO，
等 PostgreSQL 到位后改一行代码就开。

**为什么 SQLite 而不是 PostgreSQL？**
零配置。`Base.metadata.create_all` 一把梭。迁移到 PostgreSQL 只需改
`DATABASE_URL`，所有 SQLAlchemy 模型都是标准定义，不依赖 SQLite 方言。
Alembic 在 Schema 变频繁之前引入即可。

**为什么进程内 WebSocket 而不是 Redis Pub/Sub？**
单进程够用，`WebSocketManager` 就是个 `dict[int, set[WebSocket]]`。
`broadcast_to_workspace` 接口不变，未来把实现换成 Redis 通道即可，
所有调用方一行不动。

## 最近一次打磨（本轮）

- `useWorkspaceSocket` — 4 个 Hook 里一模一样的 35 行 WebSocket 逻辑，现在一处定义
- `taskTimestamp` / `taskStatusRank` / `shouldApplyTaskStatus` — 两处各自定义，现在一个 `lib/task-utils.ts`
- 死代码清退 — `SystemStatus`、`SoftwareDock`（6 个"待接入"占位符）、`selectConsoleAgents`（后端已过滤又过滤一遍）
- `ErrorBoundary` — 5 个页面各套一层，组件崩了不白屏
- `fetchedRef` — StrictMode 下不会重复请求两次
- `TaskStepEventPayload` — 手写 dict 换成 Pydantic Schema，和其他事件一致
- 模型成本 — `ModelCall.cost` 以前恒为 0，现在从 LiteLLM 响应提取
- 测试 — 前端从 2 个涨到 28 个

## 路线图

- [ ] Alembic 迁移
- [ ] Redis 消息队列替代 `asyncio.create_task`
- [ ] Worker 并行化（SQLite → PostgreSQL 后启用 `asyncio.gather`）
- [ ] Redis Pub/Sub 多进程广播
- [ ] QA 不通过 → Worker 重试循环
- [ ] 前端 WebSocket/Hook 端到端测试
- [ ] `/contacts` 通讯录页面

## License

选好了再发。

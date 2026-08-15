# PRD：工作流模板引擎 (Workflow Template Engine)

> 类型：Requirement ｜ 状态：进行中 ｜ 工单 ID：C-111

---

## 1. 目标与背景

在日常业务与软件研发过程中，许多多智能体协作任务具有高度的重复性与固定范式（例如：「需求分析 -> 架构设计 -> 代码实现 -> 代码审查 -> 自动化测试」或者「竞品调研 -> 数据提炼 -> 报告撰写」）。目前用户每次都需要在群聊中输入长篇自然语言 Prompt，容易遗漏关键约束与变量。系统需要构建「工作流模板引擎」，允许将经典的多 Agent 协作链路沉淀为结构化模板，支持配置输入参数表单，并支持一键实例化任务进行全自动流水线调度。

### 核心目标 (Goals)
- **G1（模板化多 Agent 编排）**：支持将包含多个步骤节点（Node）、指定 Agent 角色和提示词模版的工作流持久化存储。
- **G2（动态入参变量替换）**：支持在模板中声明动态参数（如 `{{project_name}}`, `{{target_language}}`），运行时自动渲染填入。
- **G3（一键实例化调度）**：支持在前端选择模板、填写参数后一键生成 Task 并自动推入持久化任务队列。
- **G4（系统预设与自定义模板）**：内置典型软件工程与研究分析模板，并允许各租户工作区自由创建和管理私有工作流。
- **G5（安全与多租户隔离）**：自定义模板按工作区严格隔离，执行权限与配额限流深度联动。

---

## 2. 用户故事 (User Stories)

- **US1（代码研发标准化）**：作为技术负责人，我将「全栈功能开发」沉淀为工作流模板，团队开发者只需输入功能描述和技术栈，系统即可自动按序唤醒 Manager、Coder、Reviewer 协作完成。
- **US2（无门槛一键执行）**：作为非技术产品经理，我可以使用预设的「竞品分析报告」模板，填入竞品名称后一键生成深度分析任务。
- **US3（模版复用与迭代）**：作为团队管理员，我可以根据实际产出效果不断微调工作流各节点的 Prompt，持续提升 Agent 产出质量。

---

## 3. 功能需求 (Functional Requirements)

| 编号 | 需求项 | 详细描述 | 优先级 |
|---|---|---|---|
| **FR1** | 工作流数据模型 | 新增 `workflow_templates` 表（第 18 张表），存储节点链路与变量定义 | P0 |
| **FR2** | 模板列表与预设 | 提供 `GET /api/v1/workspaces/{id}/workflows`，返回系统内置与工作区自定义模板 | P0 |
| **FR3** | 模板创建接口 | 提供 `POST /api/v1/workspaces/{id}/workflows`，支持保存自定义工作流节点与参数定义 | P0 |
| **FR4** | 一键实例化运行 | 提供 `POST /api/v1/workspaces/{id}/workflows/{id}/run`，替换变量并生成 Task 入队调度 | P0 |
| **FR5** | 模板删除接口 | 提供 `DELETE /api/v1/workspaces/{id}/workflows/{id}`，仅 Admin 可删除工作区模板 | P0 |
| **FR6** | 前端工作流中心 | 新增 `/workflows` 独立页面或 `/settings/workflows`，提供模板卡片、运行弹窗与创建抽屉 | P0 |
| **FR7** | 侧边栏与导航 | 在侧边栏导航中增加「工作流」入口，方便用户快速发起高频流水线任务 | P1 |
| **FR8** | 审计日志联动 | 工作流的创建、运行与删除均自动写入 `audit_logs` | P1 |

---

## 4. 数据模型设计

```sql
CREATE TABLE workflow_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL 代表系统全局预设
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(255) DEFAULT 'workflow',
    nodes_json TEXT NOT NULL, -- 步骤节点数组 JSON
    variables_json TEXT, -- 输入变量定义 JSON
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_wf_ws_id ON workflow_templates(workspace_id);
```

---

## 5. 后端 API 规范

### 1. `GET /api/v1/workspaces/{workspace_id}/workflows`
- **响应体**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "workspace_id": null,
      "name": "fullstack-feature-dev",
      "display_name": "全栈功能敏捷开发流水线",
      "description": "需求拆解 -> 架构设计 -> 编写代码 -> 质量审查",
      "icon": "code",
      "is_system": true,
      "nodes_count": 4,
      "variables": [
        { "key": "feature_name", "label": "功能名称", "required": true },
        { "key": "tech_stack", "label": "技术栈", "default": "Next.js + FastAPI" }
      ],
      "created_at": "2026-08-15T15:00:00Z"
    }
  ]
}
```

### 2. `POST /api/v1/workspaces/{workspace_id}/workflows/{id}/run`
- **请求体**：
```json
{
  "variables": {
    "feature_name": "用户头像上传",
    "tech_stack": "Next.js + S3"
  }
}
```
- **响应体**：返回新建的 `Task` 实体。

---

## 6. 验收标准 (Acceptance Criteria)

- **AC1**：系统成功创建并迁移 `workflow_templates` 数据表。
- **AC2**：支持查询系统预设模板与工作区私有模板列表。
- **AC3**：调用 `/run` 接口能够精准替换动态变量，创建 `Task` 实体并推入调度队列。
- **AC4**：前端提供 `/workflows` 工作流中心，支持可视化卡片浏览、变量填写一键运行并自动跳转任务详情。
- **AC5**：单元测试 `test_workflows.py` 与全量测试套件通过率 100%。
- **AC6**：前端 `npm run lint` 0 错误 0 警告，`npm run build` 成功。

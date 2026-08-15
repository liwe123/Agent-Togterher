# PRD：插件注册中心 (Plugin Registry)

> 类型：Requirement ｜ 状态：已完成 ｜ 工单 ID：C-110

---

## 1. 目标与背景

在多智能体协同场景中，除了系统内置的基础系统工具（如代码生成、文本处理）外，不同团队往往需要扩展特定领域的自定义工具（如 GitHub API、Jira 缺陷同步、企业内部数据库查询、Slack 机器人等）。为了避免将所有第三方工具硬编码在核心服务中，系统需要构建标准化的「插件注册中心」，允许开发者通过上传或配置 OpenAPI / JSON Manifest 注册外部工具，并支持多租户工作区按需挂载与权限启用。

### 核心目标 (Goals)
- **G1（插件 Manifest 规范）**：制定统一的插件描述规范（包含插件名称、版本、描述、端点 URL、鉴权配置与工具声明 Tool Schemas）。
- **G2（插件持久化注册）**：提供插件库存储与工作区绑定机制，支持全局公开插件与工作区私有插件。
- **G3（工具动态热加载）**：Agent 在接收到任务时，能够自动加载当前工作区已启用的插件工具并注入 LLM Function Calling 列表。
- **G4（插件管理控制台）**：前端提供插件市场与管理页面，支持可视化浏览、安装、配置 Secret 与启用/停用切换。
- **G5（安全与隔离）**：严格校验插件 Manifest 合法性，对插件请求实施超时与网络异常容错隔离。

---

## 2. 用户故事 (User Stories)

- **US1（第三方集成扩展）**：作为 DevOps 工程师，我将公司的 GitHub Action 触发接口打包为插件注册到 Agent Console，赋予 Agent 自动触发 CI/CD 构建的能力。
- **US2（工作区按需挂载）**：作为工作区管理员，我只为「研发工作区」启用了代码审查和 Git 插件，而「运营工作区」仅启用数据报表导出插件，实现工具最小权限隔离。
- **US3（无代码插件发布）**：作为算法开发者，我只需填写一段 JSON Schema 和 Webhook URL 即可发布新插件，无需重新构建后端 Docker 镜像。

---

## 3. 功能需求 (Functional Requirements)

| 编号 | 需求项 | 详细描述 | 优先级 |
|---|---|---|---|
| **FR1** | 插件数据模型 | 新增 `plugins`（插件元数据库）与 `workspace_plugins`（工作区挂载与凭证配置）两张表 | P0 |
| **FR2** | 插件注册接口 | 提供 `POST /api/v1/plugins`，支持上传/解析 Manifest 并持久化 | P0 |
| **FR3** | 插件列表接口 | 提供 `GET /api/v1/plugins`，支持按分类与公开/私有范围检索可用插件 | P0 |
| **FR4** | 工作区挂载接口 | 提供 `POST /api/v1/workspaces/{id}/plugins/{plugin_id}/toggle`，支持启用/停用插件 | P0 |
| **FR5** | 插件执行代理 | 扩展 `tools.py`，支持将 LLM 的 Function Call 动态转发至插件 Webhook 端点并回传结果 | P0 |
| **FR6** | 插件市场前端 | 新增 `/settings/plugins` 插件管理中心，提供插件卡片网格、详情弹窗与安装开关 | P0 |
| **FR7** | 设置中心导航 | 在 `/settings` 主页快捷导航网格中加入「插件生态」入口 | P1 |
| **FR8** | 审计日志联动 | 插件的新建、更新、启用/停用均自动写入 `audit_logs` | P1 |

---

## 4. 数据模型设计

```sql
CREATE TABLE plugins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(32) DEFAULT '1.0.0',
    icon VARCHAR(255),
    author VARCHAR(100),
    manifest_json TEXT NOT NULL,
    is_public BOOLEAN DEFAULT TRUE,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspace_plugins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plugin_id INTEGER NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT TRUE,
    config_json TEXT, -- 存储工作区特定的 API Key 或配置
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ix_ws_plugin_unique ON workspace_plugins(workspace_id, plugin_id);
```

---

## 5. 后端 API 规范

### 1. `GET /api/v1/plugins`
- **响应体**：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "github-tools",
      "display_name": "GitHub 协同插件",
      "description": "提供 Issue 查询、PR 审查与工作流触发工具",
      "version": "1.0.0",
      "icon": "github",
      "author": "Antigravity Team",
      "is_public": true,
      "tools_count": 3,
      "created_at": "2026-08-15T15:00:00Z"
    }
  ]
}
```

### 2. `POST /api/v1/workspaces/{workspace_id}/plugins/{plugin_id}/toggle`
- **请求体**：
```json
{
  "is_enabled": true,
  "config": {
    "api_token": "ghp_xxxxxxxx"
  }
}
```

---

## 6. 验收标准 (Acceptance Criteria)

- **AC1**：系统成功创建并迁移 `plugins` 与 `workspace_plugins` 数据表。
- **AC2**：支持通过 API 注册新插件与查询所有可用插件列表。
- **AC3**：支持在指定工作区启用/停用插件，并在任务执行时动态将插件包含的工具注入 Agent 上下文。
- **AC4**：前端提供 `/settings/plugins` 插件管理控制台，用户可直观查看插件列表、状态和启用开关。
- **AC5**：单元测试 `test_plugins.py` 与全量测试套件通过率 100%。
- **AC6**：前端 `npm run lint` 0 错误 0 警告，`npm run build` 成功。

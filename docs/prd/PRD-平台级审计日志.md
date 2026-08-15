# PRD：平台级审计日志

> 类型：Requirement ｜ 状态：已完成 ｜ 工单 ID：C-105

---

## 1. 目标与背景

随着 Agent Console 支持多租户 Workspace 与基于角色的访问控制（RBAC），企业客户对合规审计与系统安全提出了严格要求。必须对关键管理行为（如用户登录、成员邀请/角色升降、模型 API 密钥更新/删除、任务手动终止等）进行不可篡改的结构化记录，并提供统一的审计日志查询与追溯界面。

### 核心目标 (Goals)
- **G1（完整追溯）**：全生命周期记录管理与高危操作，包含操作人、动作类型、受影响资源、IP 地址、操作前后的关键参数。
- **G2（多维检索）**：支持按动作分类（认证、成员、密钥、任务）、操作人、时间范围等维度快速过滤。
- **G3（工作区隔离）**：审计日志严格按工作区归属隔离，仅 Owner/Admin 具备查看权限。
- **G4（轻量高效）**：异步写入，零性能损耗，不阻塞正常业务流。
- **G5（只读防篡改）**：审计日志仅提供 Append 与 Query 能力，不提供删除与修改 API。

---

## 2. 用户故事 (User Stories)

- **US1（安全合规审查）**：作为安全管理员，我需要定期导出和查看近期的敏感操作流水，以便满足企业等保合规要求。
- **US2（权限变动排查）**：作为工作区 Owner，当发现某成员权限被提升时，我能在审计日志中精准查出是谁在何时发起了角色变更。
- **US3（模型密钥防误删）**：作为系统运维，当发现某个 Provider 密钥被删除或修改时，能快速定位操作人与时间点。
- **US4（异常登录定位）**：作为审计人员，我能根据 IP 地址与时间排查异常账号登录轨迹。

---

## 3. 核心概念与动作映射 (Action Mapping)

| 动作标识 (`action`) | 业务名称 | 分类 (`category`) | 语义描述 |
|---|---|---|---|
| `user.register` | 用户注册 | `auth` | 记录新用户注册事件 |
| `user.login` | 用户登录 | `auth` | 记录用户登录成功事件与 IP |
| `member.invite` | 邀请成员 | `member` | 记录生成工作区邀请码与指定角色 |
| `member.join` | 成员加入 | `member` | 记录受邀成员加入工作区 |
| `member.role_update` | 角色变更 | `member` | 记录成员权限升降（如 member -> admin） |
| `member.remove` | 移除成员 | `member` | 记录移出工作区成员 |
| `provider_key.update` | 更新密钥 | `key` | 记录厂商 API Key 的保存与修改 |
| `provider_key.delete` | 删除密钥 | `key` | 记录厂商 API Key 的销毁 |
| `task.create` | 创建任务 | `task` | 记录业务任务提交 |
| `task.cancel` | 取消任务 | `task` | 记录手动终止运行中的任务 |

---

## 4. 功能需求 (Functional Requirements)

| 编号 | 需求项 | 详细描述 | 优先级 |
|---|---|---|---|
| **FR1** | 审计模型持久化 | 新增 `audit_logs` 数据表，持久化存储事件 ID、工作区、操作人、动作、资源、Payload 详情、IP 和时间戳 | P0 |
| **FR2** | 核心操作自动埋点 | 在 Auth、Members、Keys、Tasks 核心 API 路径自动触发 `record_audit_log` 异步记录 | P0 |
| **FR3** | 多维查询接口 | 提供 `GET /api/v1/workspaces/{id}/audit-logs`，支持按动作类型、操作人、分页参数过滤 | P0 |
| **FR4** | RBAC 权限拦截 | 限制仅 `owner` 与 `admin` 角色可调用审计查询接口，普通成员与观察者返回 403 Forbidden | P0 |
| **FR5** | 前端控制台界面 | 新增 `/settings/audit` 路由，提供分类标签页过滤、事件时间格式化与操作人头像/昵称展示 | P0 |
| **FR6** | Payload 详情抽屉 | 点击列表中的「查看详情」可呼出模态弹窗，格式化展示结构化 JSON 变动详情 | P1 |
| **FR7** | 导航快捷集成 | 在 `/settings` 设置中心主页挂载「操作审计日志」导航卡片 | P1 |
| **FR8** | 防篡改与数据完整性 | 数据库层与 API 层均不暴露 Update/Delete 操作接口，保持只读流水事实 | P0 |

---

## 5. 数据模型设计

```sql
CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(64),
    detail TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_audit_logs_workspace_id ON audit_logs(workspace_id);
CREATE INDEX ix_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX ix_audit_logs_action ON audit_logs(action);
CREATE INDEX ix_audit_logs_created_at ON audit_logs(created_at);
```

---

## 6. 后端 API 规范

### `GET /api/v1/workspaces/{workspace_id}/audit-logs`
- **请求头**：`Authorization: Bearer <access_token>`
- **查询参数**：
  - `action`: string (可选)
  - `resource_type`: string (可选)
  - `user_id`: int (可选)
  - `offset`: int (默认 0)
  - `limit`: int (默认 50，最大 100)
- **响应体**：
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "workspace_id": 1,
        "user_id": 1,
        "user_display_name": "系统管理员",
        "action": "member.role_update",
        "resource_type": "member",
        "resource_id": "2",
        "detail": { "old_role": "member", "new_role": "admin" },
        "ip_address": "127.0.0.1",
        "created_at": "2026-08-15T15:00:00Z"
      }
    ],
    "total": 1,
    "offset": 0,
    "limit": 50
  }
}
```

---

## 7. 验收标准 (Acceptance Criteria)

- **AC1**：触发登录、注册、成员邀请、角色修改等操作后，`audit_logs` 表准确生成对应条目。
- **AC2**：以普通 `member` 或 `viewer` 身份调用 `/audit-logs` 接口，系统返回 403 权限拒绝。
- **AC3**：在 `/settings/audit` 页面可正常切换「全部操作 / 用户认证 / 成员管理 / 模型密钥 / 任务调度」过滤分类。
- **AC4**：点击「查看详情」能清晰查看结构化 JSON Payload。
- **AC5**：单元测试 `test_audit.py` 与全量测试套件通过率 100%。
- **AC6**：前端 `npm run lint` 0 错误 0 警告，`npm run build` 成功。

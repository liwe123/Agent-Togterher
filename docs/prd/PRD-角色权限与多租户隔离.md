# PRD：角色权限与多租户隔离

> 类型：Requirement ｜ 状态：已完成 ｜ 工单 ID：C-103

## 1. 背景与问题

系统在 Phase 4 之前，所有接口和前端视图默认硬编码访问单工作区（`workspaces[0]`），没有用户与工作区的绑定关系。随着用户认证（A1）的落地，系统需要支持真正的多租户协同：
1. **租户隔离**：不同团队/租户拥有独立的工作区容器，智能体、任务、会话和密钥资产互相隔离。
2. **角色权限分级 (RBAC)**：引入明确的角色等级与操作矩阵（所有者、管理员、普通成员、观察者），防御越权操作与误配置。
3. **团队邀请与协作**：支持工作区管理员生成邀请码，新成员输入邀请码自主加入指定工作区。

## 2. 目标与非目标

### 目标
- G1: 建立 `workspace_memberships` 与 `workspace_invitations` 数据模型。
- G2: 支持四级角色权限体系（`owner` > `admin` > `member` > `viewer`）与精细化资源操作矩阵。
- G3: 提供我的工作区查询、创建工作区、邀请码生成与核销加入等全套后端 API。
- G4: 前端实现桌面侧边栏工作区切换器（Workspace Switcher）、创建/加入工作区弹层、用户信息与登出按钮。
- G5: 前端实现独立的「成员与权限管理」页面（`/settings/members`），支持角色升降级与成员移除。
- G6: 用户注册时自动绑定默认协作工作区或创建专属个人空间，确保开箱即用。

### 非目标
- N1: 本阶段不实现自定义动态权限点配置（仅使用预设 4 级静态权限矩阵）。
- N2: 本阶段不实现跨工作区数据一键迁移。

## 3. 用户故事

- US1: 作为工作区所有者 (Owner)，我希望能管理工作区的全部设置、查看成员列表并指定管理员。
- US2: 作为团队管理员 (Admin)，我希望能生成具有特定角色的邀请码、分配成员权限并移除违规成员。
- US3: 作为普通成员 (Member)，我能在工作区内创建任务、在群聊中提及 Agent 并协作，但不能篡改全局模型密钥。
- US4: 作为观察者 (Viewer)，我只能浏览群聊与任务执行轨迹，无法发起任务或生成消息，避免误操作。
- US5: 作为多团队成员，我能在侧边栏一键切换不同工作区，界面实时联动当前工作区的数据。

## 4. 核心概念

- **Workspace (工作区)**：多智能体与任务的租户隔离容器。
- **WorkspaceMembership (成员关系)**：用户与工作区的多对多映射，绑定用户在当前工作区的角色。
- **Role (角色)**：`owner`（所有者）、`admin`（管理员）、`member`（成员）、`viewer`（观察者）。
- **WorkspaceInvitation (工作区邀请)**：包含唯一 `invite_code`、目标角色和有效期的凭证。

## 5. 方案概述 / 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 16 前端交互层                     │
│  - AppSidebar 工作区切换器 (切换 / 创建 / 加入 / 退出登录)    │
│  - /settings/members 成员管理台 (角色下拉 / 移除 / 邀请弹层)   │
│  - useWorkspaces & usePermissions 响应式权限门控             │
└───────────────┬─────────────────────────────┬───────────────┘
                │ REST API (Bearer JWT)       │
                ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 核心控制层                       │
│  - endpoints/workspace_members.py (my/members/invite/join)  │
│  - core/permissions.py (ROLE_HIERARCHY & PERMISSION_MATRIX) │
│  - require_workspace_role & require_workspace_permission    │
└───────────────┬─────────────────────────────┬───────────────┘
                │ AsyncSession                │
                ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    SQLAlchemy 数据持久层                    │
│  - users 表                                                 │
│  - workspaces 表                                            │
│  - workspace_memberships 表 (user_id, workspace_id, role)   │
│  - workspace_invitations 表 (workspace_id, invite_code...)  │
└─────────────────────────────────────────────────────────────┘
```

## 6. 功能需求 (FR)

| 编号 | 需求描述 | 优先级 |
|---|---|---|
| FR1 | 新增 `workspace_memberships` 与 `workspace_invitations` 数据库模型与关联 | P0 |
| FR2 | 后端 RBAC 角色层级矩阵与 FastAPI 权限拦截依赖（403 错误拦截） | P0 |
| FR3 | 用户注册时自动建立 WorkspaceMembership（首个用户为 Owner，后续为 Member） | P0 |
| FR4 | `GET /api/v1/workspaces/my`：获取当前登录用户已加入的工作区及对应角色 | P0 |
| FR5 | `POST /api/v1/workspaces`：创建新工作区，当前用户自动成为 Owner | P0 |
| FR6 | `GET /api/v1/workspaces/{id}/members`：获取指定工作区成员列表与角色 | P0 |
| FR7 | `POST /api/v1/workspaces/{id}/members/invite`：Admin/Owner 生成邀请码 | P0 |
| FR8 | `POST /api/v1/workspaces/join`：用户使用邀请码加入工作区并继承指定角色 | P0 |
| FR9 | `PUT /api/v1/workspaces/{id}/members/{user_id}/role`：修改成员角色 | P0 |
| FR10 | `DELETE /api/v1/workspaces/{id}/members/{user_id}`：移除工作区成员 | P0 |
| FR11 | 前端侧边栏工作区切换器：展示当前工作区与角色徽章，支持一键切换与弹层操作 | P0 |
| FR12 | 前端成员管理页面 `/settings/members` 与设置页入口卡片 | P0 |
| FR13 | 侧边栏底部当前用户信息卡片与一键退出登录（Logout） | P0 |

## 7. 流程设计

### 7.1 邀请码加入流程
1. Admin 用户在 `/settings/members` 选择角色（如 `member`）并点击「生成邀请码」。
2. 后端生成 16 字节 URL-safe 随机字符串，存入 `workspace_invitations` 表（默认 7 天有效）。
3. 被邀请用户登录后，在侧边栏点击「输入邀请码加入」，提交 invite_code。
4. 后端验证邀请码存在性、未过期、非已使用，并在 `workspace_memberships` 表中插入记录。
5. 前端自动切换至新加入的工作区。

### 7.2 权限拦截流程
1. 请求到达受保护接口（如修改模型配置）。
2. `get_current_user_dep` 验证 Bearer JWT 提取用户身份。
3. `get_current_membership` 查询当前用户在该工作区的 Membership。
4. `require_workspace_role` 校验角色等级是否满足要求，不满足返回 `403 Forbidden`。

## 8. 数据设计

### 8.1 workspace_memberships 表
| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | Integer | PK, autoincrement | 主键 |
| user_id | Integer | FK users.id, NOT NULL | 用户 ID |
| workspace_id | Integer | FK workspaces.id, NOT NULL | 工作区 ID |
| role | String(32) | NOT NULL, DEFAULT "member" | 角色 (owner/admin/member/viewer) |
| joined_at | DateTime | DEFAULT utc_now | 加入时间 |

*唯一约束：`uq_user_workspace_membership (user_id, workspace_id)`*

### 8.2 workspace_invitations 表
| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | Integer | PK, autoincrement | 主键 |
| workspace_id | Integer | FK workspaces.id, NOT NULL | 工作区 ID |
| inviter_id | Integer | FK users.id, NOT NULL | 邀请人 ID |
| invitee_email | String(255) | NULLABLE | 被邀请人邮箱 |
| invite_code | String(64) | UNIQUE, NOT NULL | 邀请码 |
| role | String(32) | NOT NULL, DEFAULT "member" | 预设角色 |
| status | String(32) | DEFAULT "pending" | 状态 (pending/accepted/expired) |
| expires_at | DateTime | NOT NULL | 过期时间 |
| created_at | DateTime | DEFAULT utc_now | 创建时间 |

## 9. 前端交互需求

1. **侧边栏工作区切换器**：
   - 顶部 Logo 下方提供交互触发点，Hover 提示当前工作区与角色。
   - 点击弹出工作区列表浮层，展示所有已加入工作区及当前激活对勾。
   - 底部提供「创建新工作区」、「输入邀请码加入」、「成员与权限管理」快捷按钮。
2. **成员与权限管理台 (`/settings/members`)**：
   - 成员总数指示器、用户头像与基本信息列表。
   - 权限下拉选择器：Admin/Owner 可直接切换普通成员角色，普通成员展示只读徽章。
   - 移除成员二次确认弹窗。
   - 生成邀请码弹窗：支持角色预设与一键复制功能。
3. **设置中心整合**：
   - `/settings` 设置页顶部加入醒目的「工作区成员与权限管理」导流卡片。

## 10. 安全与合规

- **越权防御 (IDOR 防护)**：所有成员和工作区操作均显式校验 `user_id` 与 `workspace_id` 的归属及当前请求者的权限等级。
- **自保护机制**：禁止通过普通接口移除自身或降低 Owner 的权限，避免孤儿工作区。
- **邀请码安全**：使用加密安全的 `secrets.token_urlsafe(16)`，且设置过期校验与一次性状态流转。

## 11. 验收标准 (AC)

- AC1: 用户可通过 `/api/v1/workspaces/my` 获取自身加入的工作区与对应角色。
- AC2: 用户可创建新工作区并自动被赋予 `owner` 角色。
- AC3: Admin/Owner 可生成邀请码，其他用户可通过邀请码加入并获得指定角色。
- AC4: 越权操作（如 Member 试图生成邀请码或修改他人角色）均被 HTTP 403 拦截。
- AC5: 前端侧边栏切换器可正常切换活跃工作区，并可打开创建与加入弹窗。
- AC6: 前端 `/settings/members` 页面可正常展示成员列表、修改角色、移除成员并生成邀请码。
- AC7: 后端全量测试通过（`test_permissions.py` 与既有测试共 100 项测试通过）。
- AC8: 前端测试全部通过（28 项），ESLint 检查 0 错误 0 警告，生产构建正常编译。

## 12. 里程碑

| 阶段 | 内容 | 交付物 |
|---|---|---|
| M1 | 数据模型与权限核心 | `membership.py`, `permissions.py` |
| M2 | 后端 API 接口与集成测试 | `workspace_members.py`, `test_permissions.py` |
| M3 | 前端多租户状态与切换器 | `use-workspaces.ts`, `app-sidebar.tsx` |
| M4 | 成员管理页面与交互 | `src/app/settings/members/page.tsx` |
| M5 | 自动化测试与文档验收 | 100 pytest + 28 frontend tests + PRD 同步 |

## 13. 结论

本需求的交付使 Agent Console 从单租户原型正式跃升为支持多人多团队、安全角色分级与租户隔离的工业级协作平台，为后续批次的审计日志与配额管理奠定了坚实基石。

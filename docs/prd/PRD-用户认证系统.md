# PRD：用户认证系统

> 类型：Requirement ｜ 状态：进行中 ｜ ID：C-100

## 1. 背景与问题

当前系统使用 `APP_API_TOKEN` 环境变量做静态 Token 鉴权（`security.py`），前端将用户硬编码为 `"你"`（`sender_type: "user"`, `sender_id: null`）。这种方式无法区分不同用户的身份，无法支持多人协作，也无法进行操作审计。

P4 产品化阶段的所有后续功能（RBAC 权限、多租户、审计日志、配额管理）都依赖用户身份识别，因此用户认证系统是最高优先级的前置需求。

## 2. 目标与非目标

### 目标
- G1: 支持邮箱 + 密码的用户注册和登录
- G2: 签发 JWT access_token + refresh_token，支持无感续期
- G3: 所有 API 和 WebSocket 连接必须经过身份验证
- G4: 与现有 API Token 机制（APP_API_TOKEN）保持向后兼容
- G5: 前端提供登录页和注册页，未登录自动跳转

### 非目标
- N1: 本阶段不实现 OAuth / SSO / 第三方登录
- N2: 本阶段不实现密码找回 / 邮箱验证
- N3: 本阶段不实现用户个人资料编辑页

## 3. 用户故事

- US1: 作为新用户，我希望通过邮箱和密码注册账号，成为系统的合法用户
- US2: 作为已注册用户，我希望通过邮箱和密码登录系统，进入工作台
- US3: 作为已登录用户，我希望 token 过期后系统自动续期，不需要重复登录
- US4: 作为系统管理员，我希望未认证的请求被拒绝，保护系统安全
- US5: 作为运维人员，我希望现有 APP_API_TOKEN 机制继续可用，不影响自动化脚本

## 4. 核心概念

- **User（用户）**: 系统中的人类操作者，通过邮箱唯一标识
- **access_token**: 短期 JWT（15 分钟），用于 API 请求认证
- **refresh_token**: 长期 JWT（7 天），用于换发新 access_token
- **API Token**: 现有的静态 token 机制，用于自动化/脚本场景

## 5. 功能需求 (FR)

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR1 | 用户注册：邮箱+密码注册，密码 bcrypt 加盐存储 | P0 |
| FR2 | 用户登录：邮箱+密码验证，签发 access_token(15min) + refresh_token(7d) | P0 |
| FR3 | Token 刷新：refresh_token 有效期内换发新 access_token | P0 |
| FR4 | 用户登出：前端清除 token，后端 Redis token 黑名单（可选） | P1 |
| FR5 | API 鉴权中间件：扩展现有 security.py，支持 JWT 验证 + 注入 current_user | P0 |
| FR6 | WebSocket 鉴权：握手阶段验证 JWT，拒绝未认证连接 | P0 |
| FR7 | 前端登录页：/login 路由，邮箱+密码表单 | P0 |
| FR8 | 前端注册页：/register 路由，邮箱+密码+确认密码表单 | P0 |
| FR9 | 前端路由守卫：未登录自动跳转 /login | P0 |
| FR10 | API 客户端升级：所有请求自动附加 Authorization header | P0 |
| FR11 | 向后兼容：现有 APP_API_TOKEN 仍可用于 API 认证 | P0 |

## 6. 数据模型

### 新增 users 表

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | Integer | PK, autoincrement | 用户 ID |
| email | String(255) | UNIQUE, NOT NULL | 邮箱 |
| password_hash | String(255) | NOT NULL | bcrypt 哈希密码 |
| display_name | String(100) | NOT NULL | 显示名称 |
| avatar | String(255) | NULLABLE | 头像 URL |
| is_active | Boolean | DEFAULT true | 是否启用 |
| created_at | DateTime | DEFAULT utc_now | 注册时间 |
| last_login_at | DateTime | NULLABLE | 最近登录时间 |

## 7. 后端接口设计

### POST /api/v1/auth/register
请求：`{"email": "...", "password": "...", "display_name": "..."}`
响应：`{"success": true, "data": {"user": {...}, "access_token": "...", "refresh_token": "..."}}`

### POST /api/v1/auth/login
请求：`{"email": "...", "password": "..."}`
响应：同上

### POST /api/v1/auth/refresh
请求：`{"refresh_token": "..."}`
响应：`{"success": true, "data": {"access_token": "..."}}`

### POST /api/v1/auth/logout
请求：空（bearer token 在 header）
响应：`{"success": true, "data": {"message": "已登出"}}`

### GET /api/v1/auth/me
响应：`{"success": true, "data": {"id": 1, "email": "...", "display_name": "...", ...}}`

## 8. 前端设计

### 登录页 (/login)
- 深色主题，居中卡片表单
- 邮箱输入框 + 密码输入框 + 登录按钮
- 底部「没有账号？注册」链接
- 登录成功后跳转到首页 /

### 注册页 (/register)
- 深色主题，居中卡片表单
- 邮箱 + 显示名称 + 密码 + 确认密码 + 注册按钮
- 底部「已有账号？登录」链接
- 注册成功后自动登录并跳转首页

### 路由守卫
- Next.js middleware.ts 检查 localStorage 中的 token
- 无 token 的请求重定向到 /login
- /login 和 /register 页面无需认证

## 9. 安全考虑

- 密码使用 bcrypt 加盐哈希存储，不可逆
- JWT 使用 HS256 算法，密钥从环境变量 `JWT_SECRET_KEY` 读取
- access_token 有效期 15 分钟，refresh_token 有效期 7 天
- 登录失败不透露「用户不存在」还是「密码错误」，统一返回「邮箱或密码错误」
- WebSocket 鉴权失败使用 1008 状态码关闭连接（与现有实现一致）

## 10. 验收标准 (AC)

- AC1: 用户可通过邮箱+密码完成注册，注册后自动登录并跳转首页
- AC2: 用户可通过邮箱+密码登录，登录后获取 access_token 和 refresh_token
- AC3: 未认证的 API 请求返回 401，前端自动重定向到 /login
- AC4: access_token 过期后，前端通过 refresh_token 自动换发新 token，用户无感知
- AC5: WebSocket 未认证连接被拒绝（1008 状态码）
- AC6: 现有 APP_API_TOKEN 机制仍然可用（向后兼容）
- AC7: 后端测试全部通过（pytest backend/tests）
- AC8: 前端构建和 lint 通过（npm run build && npm run lint）

## 11. 里程碑

| 阶段 | 内容 | 交付物 |
|---|---|---|
| M1 | 后端 User 模型 + JWT 认证逻辑 | users 表, auth.py |
| M2 | Auth API（register/login/refresh/me） | auth endpoints |
| M3 | 安全中间件升级（JWT + API Token 双轨） | security.py 扩展 |
| M4 | WebSocket 鉴权升级 | websocket/router.py |
| M5 | 前端登录/注册页 + 路由守卫 + API client 升级 | 前端全部改动 |
| M6 | 测试与验收 | 测试通过 |

## 12. 风险与待定项

- R1: SQLite 并发写入限制可能影响高频登录场景，生产部署前需迁移 PostgreSQL
- R2: JWT 黑名单依赖 Redis，如 Redis 不可用则降级为不支持主动失效
- R3: 前端 token 存储在 localStorage 存在 XSS 风险，后续可升级为 httpOnly cookie

## 13. 与现有系统的关系

- 扩展 `security.py`：增加 JWT 验证，保留原有 API Token 验证
- 扩展 `main.py` 中间件：识别 JWT 和 API Token 两种认证方式
- 扩展 `websocket/router.py`：JWT 握手鉴权
- 扩展 `task-api.ts`：自动附加 Authorization header
- 新增 `middleware.ts`：Next.js 路由守卫

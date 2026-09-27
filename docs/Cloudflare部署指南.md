# Cloudflare 免费部署指南

> 目标：用 Cloudflare 免费服务把 Agent Console 整体对外发布。
> 结论先行：**前端跑在 Cloudflare Workers（免费），后端（FastAPI + worker + PostgreSQL + Redis + 桥接）经 Cloudflare Tunnel（免费）回源本地/自有主机。**
> Python 后端无法运行在 Cloudflare 免费算力上（Workers Python 不支持 asyncpg/子进程/文件系统，且 CF 无免费 PG/Redis），Tunnel 方案零重写且保留本地-first 的桥接能力。

---

## 1. 架构

```
浏览器
 ├─ https://agent-console.<子域>.workers.dev ──► Cloudflare Workers（Next.js 前端，@opennextjs/cloudflare）
 └─ https://<随机或自定义域名> ────────────────► Cloudflare Tunnel（免费，支持 WebSocket）
                                                  └─► 本机后端 FastAPI:8000
                                                        ├─ PostgreSQL / Redis（compose 内部，不暴露公网）
                                                        └─ worker + bridge（数据目录挂载在宿主机）
```

- REST 与 WebSocket 共用同一个后端地址：前端构建期变量 `NEXT_PUBLIC_API_BASE_URL`（`http→ws` 自动推导）。
- Cloudflare 免费层覆盖：Workers（10 万请求/天）、Tunnel（无限流量）、DNS/TLS/CDN/WAF。
- CI/CD 门禁仍在 GitHub Actions，与部署解耦。

---

## 2. 前置条件

- Cloudflare 账号（免费）；暂时没有域名也可以（用 `trycloudflare.com` 快速隧道）
- 主机（本机即可）已装 Docker Desktop / Docker Engine + Compose
- Node.js 24+（仅前端构建用）
- 后端 `.env` 至少配置：模型 Key（任选一个）、`JWT_SECRET_KEY`

---

## 3. 第一步：后端 + 快速隧道（先拿到公网 API 地址）

```powershell
# 1) 准备 .env（首次）：复制 .env.example 并按需填写
Copy-Item .env.example .env

# 2) 只需在 .env 补一个随机 JWT 密钥（生产 fail-closed 强制要求）
python -c "import secrets; print('JWT_SECRET_KEY=' + secrets.token_urlsafe(48))" | Add-Content .env

# 3) 启动后端栈 + 快速隧道（tunnel 在 cf profile 下，不影响日常开发）
docker compose --profile cf up -d

# 4) 等待 backend healthy 后，读取隧道分配的公网地址
docker compose logs tunnel | Select-String "trycloudflare.com"
# 形如：https://random-words-1234.trycloudflare.com
```

把该地址记为 `API_URL`。快速隧道重启后会变化，仅用于验证；正式使用见第 6 节命名隧道。

验证：

```powershell
Invoke-WebRequest "$API_URL/api/v1/health" | Select-Object -ExpandProperty Content
```

---

## 4. 第二步：前端部署到 Cloudflare Workers（OpenNext）

```powershell
cd frontend

# 1) 安装依赖（已包含 @opennextjs/cloudflare 与 wrangler）
npm ci

# 2) 用第 3 步得到的公网地址做构建期注入（NEXT_PUBLIC_* 在构建期内联）
$env:NEXT_PUBLIC_API_BASE_URL = "<API_URL>"
npm run deploy        # = opennextjs-cloudflare build && opennextjs-cloudflare deploy

# 首次运行会要求登录 Cloudflare：
#   wrangler login  （浏览器授权，免费账号即可）
```

成功后输出 `https://agent-console.<你的子域>.workers.dev`，记为 `APP_URL`。

本地预览（不消耗线上配额）：

```powershell
npm run preview   # 构建 + 本地 workerd 预览
```

---

## 5. 第三步：回填 CORS 并验证

浏览器从 `APP_URL` 调用 `API_URL` 属于跨域，需要把 Workers 来源加入后端白名单：

```powershell
# .env
CORS_ORIGINS=["<APP_URL>", "http://localhost:3000", "http://127.0.0.1:3000"]

# 重启后端生效
docker compose up -d backend
```

验证清单：

1. 打开 `APP_URL` → 注册/登录成功（REST 通）
2. 首页连接状态徽章显示「在线」（WebSocket 通）
3. 发一条 `@项目总设计师 你好` → 任务执行、时间线实时刷新
4. 任务详情页可回放；成本/审计页有数据

---

## 6. 升级为命名隧道（有域名后推荐）

1. Cloudflare 控制台 → Zero Trust → Networks → Tunnels → 创建隧道 → 复制 **Token**
2. `.env` 设置：

```powershell
TUNNEL_TOKEN=<隧道 Token>
CLOUDFLARED_COMMAND=tunnel --no-autoupdate run
CORS_ORIGINS=["https://app.example.com", "<APP_URL>"]
```

3. 在隧道配置里添加 Public Hostname：`api.example.com → http://backend:8000`
4. 重启隧道：`docker compose --profile cf up -d tunnel`
5. 前端用 `NEXT_PUBLIC_API_BASE_URL=https://api.example.com` 重新 `npm run deploy`
6. Workers 可绑定自定义域名：`wrangler.jsonc` 加 `routes` 或控制台配置 `app.example.com`

---

## 7. 生产加固清单

| 项 | 说明 |
|---|---|
| `JWT_SECRET_KEY` | 非开发环境必填，缺失启动即拒绝（P0-4 fail-closed） |
| `APP_ENV=production` | 同时触发上述 fail-closed 校验 |
| 只暴露 8000/3000 | `db`/`redis` 仅 compose 内部网络；Tunnel 只指向 `backend:8000` |
| Cloudflare Access（可选） | Zero Trust 免费 50 用户，可给 `APP_URL`/`api.example.com` 加登录门 |
| WS Token 现状 | 前端 WS 以 `?token=` 传 JWT（已知项，见审查报告 REQ-D2）；Tunnel 不落公网访问日志，但仍建议后续升级子协议鉴权 |
| R2 缓存（可选） | 需要 ISR 再启用（当前页面均为客户端取数，未开启） |

---

## 8. 免费额度参考

| 服务 | 免费额度 | 本项目占用 |
|---|---|---|
| Workers | 10 万请求/天、静态资源免费 | 页面导航与 SSR 请求，小团队充足 |
| Cloudflare Tunnel | 无限流量 | 全部 API/WS 流量 |
| DNS/TLS/CDN/WAF | 免费 | 全量 |
| 动态 Workers 请求注意 | 每次页面导航≈1 请求；静态资源不计 | 高频刷新场景可改静态导出或加缓存 |

---

## 9. 故障排查

| 现象 | 排查 |
|---|---|
| 页面请求 401/跨域报错 | 回填 `CORS_ORIGINS` 并重启 backend；确认 `NEXT_PUBLIC_API_BASE_URL` 是 HTTPS 的隧道地址且已重新构建 |
| WebSocket 一直离线 | `wrangler.jsonc` 无需改；确认隧道在线（`docker compose ps tunnel`）且地址可达 `$API_URL/ws/...`；浏览器控制台看 `wss://` 连接错误 |
| `npm run deploy` 报 Next 版本不兼容 | 适配器 1.20.0 要求 Next ≥16.2.6（本项目 16.2.9 满足）；若升级 Next 需同步升级适配器 |
| 快速隧道地址变了 | 重新设置 `NEXT_PUBLIC_API_BASE_URL` 并 `npm run deploy`（地址是构建期内联的） |
| 隧道 502 | `docker compose logs backend` 看后端健康；`depends_on` 已等待 healthy |

---

## 10. 相关文件

- `frontend/wrangler.jsonc`、`frontend/open-next.config.ts`、`frontend/public/_headers`
- `frontend/package.json` scripts：`preview` / `deploy` / `upload` / `cf-typegen`
- `docker-compose.yml` 的 `tunnel` 服务（`profiles: ["cf"]`）
- `.env.example` 的 Cloudflare 段

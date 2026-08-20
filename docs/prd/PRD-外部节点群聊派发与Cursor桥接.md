# PRD：外部节点群聊派发与 Cursor 桥接

> 类型：新需求（Requirement）｜状态：待实施（方案已定，方案 B：文件桥，Docker 友好）｜目标：让群聊 `@Cursor` 能真正派活到 Cursor 集成节点，并通过宿主文件系统桥接让 Cursor IDE 受控产出 `output.md` 回写群聊；补齐「外部 Agent 软件接入」（C-118 / C-129）当前缺失的路由与真实执行链路。

---

## 1. 背景与问题

项目已在 C-118 / C-129 完成「外部 Agent 软件接入与调度」基座：`integration_nodes` 表、Bridge 适配器框架、Cursor Bridge、Codex CLI Bridge 与动态 Software Dock 已就绪。但从群聊派活到节点真实执行之间存在两处断点：

1. **群聊 `@Cursor` 不路由到 Cursor 节点**
   - `MessageHub._select_agent` 只匹配 `agents` 表，`@Cursor` 在 `agents` 表未命中后会落到默认内部 Agent（项目总设计师），走 LLM 编排，而不是派发给已注册的 Cursor 集成节点。

2. **`CursorBridge.execute` 是桩**
   - 当前仅把任务目录文件写出来（PROMPT.md 等），并不真正执行、也不读取 `output.md` 回填结果，因此节点在软件 Dock 上可能出现却无法产出任务结果。

3. **Docker 隔离约束**
   - 后端运行在 Docker 容器内，宿主机的 Cursor / Codex 二进制在容器内不可达；容器用 `127.0.0.1` 访问宿主 node endpoint 也访问不到。容器与宿主是两张网络，外部 IDE 无法在容器内无头执行。

### 本轮要解决的问题

- 让群聊 `@Cursor` 在命中 `integration_nodes` 节点后，把任务派发给该节点（`dispatch_task_to_node`），而非内部 LLM 编排。
- 让 `CursorBridge` 在 `prepare_task` 之后真正轮询任务工作目录下的 `output.md`，以「非空」作为完成判定，回填为任务结果，超时为失败并留痕。
- 让容器内生成的任务目录对宿主机可见（bind mount），由宿主上新增的纯标准库桥接客户端驱动 Cursor IDE 受控执行并回写结果。

---

## 2. 目标与非目标

### 2.1 目标

- G1：群聊 `@Cursor` 在 `agents` 表未命中后，按工作区精确匹配 `integration_nodes` 节点名，命中即派发到该节点而非内部编排。
- G2：`CursorBridge` 真实执行：`prepare_task` 后轮询 `output.md` 至非空（默认 600s，可由 `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 调整），成功回填结果、超时视为失败，超时/结果写入 `events.jsonl` 留痕。
- G3：Docker 共享：`docker-compose.yml` 给 backend 增加 bind mount `./data/bridges:/app/data/bridges`，与数据库 named volume 共存、互不影响，使容器生成的任务目录对宿主机可见。
- G4：宿主桥接客户端（新增 `bridge/cursor_client.py`，纯 Python 标准库）每 ~10s 发心跳使节点 online（前端 Software Dock 实时显示），并轮询 `E:/Agents/data/bridges/workspace-*/Cursor/task-*` 新任务目录，用 `E:/cursor/resources/app/bin/cursor <task_dir>` 打开 Cursor IDE，等待 `output.md` 写出后标记处理完成。
- G5：前端群聊 @ 菜单（MentionMenu）合并展示外部节点（Cursor/Codex/Trae/Antigravity），选中插入 `@Cursor` 文本，后端已能路由。

### 2.2 非目标

- N1：不在容器内无头执行宿主 Cursor / Codex 二进制（Docker 网络隔离，不可达）。
- N2：本阶段不实现 Codex / Trae / Antigravity 的真实执行（标注为 P2 / 未来阶段）。Codex 节点可复用宿主 `codex exec` 无头执行（本机已装 codex 0.117.0）；Cursor 本轮只做「受控 IDE 节点 + 文件系统桥接」。
- N3：不改动 `integration_nodes` 表结构与 Bridge 适配器框架主体（沿用 C-118 已实现）。

---

## 3. 用户故事

- US1：作为用户，我希望在群聊里输入 `@Cursor` 并派活时，任务真正被派到已注册的 Cursor 节点，而不是落到项目总设计师走内部 LLM 编排。
- US2：作为用户，我希望在软件 Dock（Software Dock）上能看到 Cursor 节点「在线」，并实时反映其心跳状态。
- US3：作为用户，我希望 `@Cursor` 派出的任务被派到 Cursor 节点后，Cursor IDE 自动打开对应任务目录（PROMPT.md 已就位），我在 IDE 里完成工作并把结果写进 `output.md`。
- US4：作为用户，我希望 Cursor 在 `output.md` 写出的结果能被后端轮询读取，并作为任务结果回写群聊，过程可在任务步骤中看到 `integration_dispatch:cursor:Cursor` 等轨迹。
- US5：作为系统/运维，我希望容器生成的任务目录对宿主机可见，由宿主桥接客户端驱动外部 IDE，而不是依赖容器内不可达的宿主二进制。
- US6：作为未来用户，我期待 Codex / Trae / Antigravity 在后续阶段也能以类似桥接方式接入（Codex 可无头执行），本轮仅打标不实现。

---

## 4. 核心概念

### 4.1 集成节点（Integration Node）
已注册到 `integration_nodes` 表的外部 Agent 软件（Cursor / Codex / Trae / Antigravity），含节点名、类型、工作区、online 状态等。本轮聚焦 Cursor。

### 4.2 @提及路由（Mention Routing）
群聊消息解析出 `@Cursor` 后，`MessageHub` 先在 `agents` 表按名匹配；未命中再按当前工作区查 `integration_nodes` 精确匹配节点名；命中即走 `dispatch_task_to_node`，绕过内部 LLM 编排。

### 4.3 文件桥（File Bridge）
以共享目录 `data/bridges/workspace-*/<Node>/task-*` 作为容器与宿主之间的任务交接面：容器侧 `prepare_task` 写 PROMPT.md，宿主侧桥接客户端发现目录并驱动 IDE，IDE 写 `output.md` 后由容器侧轮询回填。

### 4.4 受控 IDE 节点（Controlled IDE Node）
Cursor 本轮定位为「受控 IDE 节点」：读取 `PROMPT.md`、在 `output.md` 写出结果，不在容器内无头执行。

### 4.5 心跳（Heartbeat）
宿主桥接客户端定时 `POST /api/v1/integrations/nodes/{id}/heartbeat`，使节点在 `integration_nodes` 标记为 online，前端 Software Dock 实时展示。

---

## 5. 方案概述（方案 B：文件桥，Docker 友好）

在「外部 Agent 软件接入」基座之上补齐两条链路：

1. **路由链路**：群聊 `@Cursor` → `MessageHub` 在 `agents` 表未命中后按工作区查 `integration_nodes` 精确匹配 → 命中则 `dispatch_task_to_node` 派发到节点（不走内部 LLM 编排）。
2. **执行链路（文件桥）**：
   - 容器侧 `CursorBridge.prepare_task` 在 `data/bridges/workspace-*/Cursor/task-*` 写出任务目录（PROMPT.md 就位）。
   - 宿主侧 `bridge/cursor_client.py`（纯标准库）轮询新任务目录，用 `E:/cursor/resources/app/bin/cursor <task_dir>` 打开 Cursor IDE；用户在 IDE 内工作并写 `output.md`。
   - 容器侧 `CursorBridge.execute` 在 `prepare_task` 后轮询该目录 `output.md`，直到非空；成功读 `output.md` 内容为任务结果，超时（默认 600s，`BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 可调）为失败；超时 / 结果写入 `events.jsonl`。
   - 宿主侧桥接客户端在发现 `output.md` 非空后标记该任务目录处理完成。

Docker 共享：`docker-compose.yml` 给 backend 增加 bind mount `./data/bridges:/app/data/bridges`，与数据库 named volume 共存、互不影响，使容器生成目录对宿主机可见。

---

## 6. 功能需求（FR）

| 编号 | 需求 | 优先级 |
|------|------|--------|
| FR1 | 群聊 `@Cursor`：MessageHub 在 `agents` 表未命中后，按当前工作区查 `integration_nodes` 精确匹配节点名，命中即 `dispatch_task_to_node` 派发，而非内部 LLM 编排 | P0 |
| FR2 | `CursorBridge.execute` 真实执行：在 `prepare_task` 后轮询任务工作目录 `output.md`，直到出现非空内容；默认超时 600s，可由 `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 调整 | P0 |
| FR3 | 执行结果回填：成功时读取 `output.md` 内容作为任务结果；超时为失败；超时 / 结果写入任务目录 `events.jsonl` 留痕 | P0 |
| FR4 | Docker 共享：`docker-compose.yml` 给 backend 增加 bind mount `./data/bridges:/app/data/bridges`，与数据库 named volume 共存、互不影响 | P0 |
| FR5 | 宿主桥接客户端：新增 `bridge/cursor_client.py`（纯 Python 标准库），每 ~10s `POST /api/v1/integrations/nodes/{id}/heartbeat` 使节点 online，前端 Software Dock 实时显示 | P1 |
| FR6 | 宿主桥接客户端轮询 `E:/Agents/data/bridges/workspace-*/Cursor/task-*` 新任务目录，发现后用 `E:/cursor/resources/app/bin/cursor <task_dir>` 打开 Cursor IDE（PROMPT.md 已就位） | P1 |
| FR7 | 宿主桥接客户端在 `output.md` 非空后标记该任务目录处理完成，供容器侧轮询回填 | P1 |
| FR8 | 前端群聊 @ 菜单（MentionMenu）合并展示外部节点（Cursor/Codex/Trae/Antigravity），选中插入 `@Cursor` 文本 | P1 |
| FR9 | 路由命中 `integration_nodes` 时，任务步骤产生 `integration_dispatch:cursor:Cursor` 等可追踪步骤，状态最终置为 completed | P0 |
| FR10 | Codex / Trae / Antigravity 标注为后续阶段（P2 / 未来）：Codex 节点可复用宿主 `codex exec` 无头执行（本机已装 codex 0.117.0）；本轮 Cursor 仅做「受控 IDE 节点 + 文件系统桥接」 | P2 |

---

## 7. 任务流转设计

### 7.1 群聊 @Cursor 派活（路由）

1. 用户在群聊输入 `@Cursor 帮我重构这块代码` 并发送。
2. `MessageHub` 解析 `@Cursor`，先在 `agents` 表按名匹配——未命中。
3. 按当前工作区查 `integration_nodes`，精确匹配节点名 `Cursor`——命中。
4. 调用 `dispatch_task_to_node` 把任务派发给 Cursor 节点，任务步骤记录 `integration_dispatch:cursor:Cursor`，绕过内部 LLM 编排。
5. 任务进入节点执行流程（见 7.2），完成后状态置为 `completed`。

### 7.2 Cursor 执行（文件桥）

1. 容器侧 `CursorBridge.prepare_task` 在 `data/bridges/workspace-*/Cursor/task-*` 写出任务目录（PROMPT.md 已就位）。
2. 宿主侧 `bridge/cursor_client.py` 轮询发现该任务目录，调用 `E:/cursor/resources/app/bin/cursor <task_dir>` 打开 Cursor IDE。
3. 用户在 IDE 内依据 PROMPT.md 工作，把结果写进 `output.md`。
4. 容器侧 `CursorBridge.execute` 轮询 `output.md` 直到非空（受 `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 约束）。
5. 成功：读取 `output.md` 内容为任务结果回填；宿主侧标记目录处理完成。
6. 超时：判定失败，超时事件写入 `events.jsonl`；任务结果标记为失败。

---

## 8. 数据设计

### 8.1 复用现有表 / 结构

- `integration_nodes`：沿用 C-118 已实现，含节点名、类型、工作区、online 状态等；本轮通过心跳更新 online 字段，不改表结构。
- `Task` / `TaskStep`：沿用现有任务与步骤模型；新增 `integration_dispatch:cursor:Cursor` 类步骤用于轨迹追踪。
- `events.jsonl`：每个任务目录下新增留痕文件，记录超时 / 结果事件（非数据库，文件系统契约）。

### 8.2 新增 / 调整项

- 新增宿主桥接客户端：`bridge/cursor_client.py`（纯 Python 标准库，无第三方依赖）。
- 新增配置项：`BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS`（默认 600），控制 `output.md` 轮询超时。
- 新增 Docker bind mount：`./data/bridges:/app/data/bridges`。
- 说明：本轮不新增数据库表，复用 C-118 的 `integration_nodes`。

---

## 9. 前端体验需求

- 群聊 @ 菜单（MentionMenu）：合并展示外部节点（Cursor / Codex / Trae / Antigravity），选中即插入 `@Cursor` 文本，后端已能路由。
- 软件 Dock（Software Dock）：实时反映 Cursor 节点 online 状态（由宿主桥接客户端心跳驱动），用户可直观看到节点是否在线并接入。
- 任务详情：展示 `integration_dispatch:cursor:Cursor` 步骤与最终 `completed` 状态、回写的 `output.md` 内容。

---

## 10. 后端实现建议

- `MessageHub._select_agent`：在 `agents` 表匹配后增加第二道 `integration_nodes` 精确匹配（按工作区 + 节点名），命中返回节点派发路径。
- `CursorBridge.execute`：由桩改为真实执行——`prepare_task` 后进入轮询循环，检查 `output.md` 非空；超时按 `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 退出并判失败；结果 / 超时写 `events.jsonl`。
- 心跳端点：`POST /api/v1/integrations/nodes/{id}/heartbeat` 支撑宿主客户端刷新节点 online 状态。
- Docker：`docker-compose.yml` backend 增加 bind mount，与数据库 named volume 并存。
- 宿主客户端：`bridge/cursor_client.py` 用 `urllib` 发心跳、用 `glob`/`os` 轮询 `data/bridges`、用 `subprocess` 调 Cursor 二进制，纯标准库实现。

---

## 11. 安全与合规

- 宿主桥接客户端使用纯 Python 标准库，不引入额外依赖，降低攻击面。
- Cursor 二进制路径（`E:/cursor/resources/app/bin/cursor`）与桥接目录（`E:/Agents/data/bridges`）为宿主本地路径，不在容器内执行，避免容器越权访问宿主。
- `output.md` 内容作为任务结果回填前，沿用现有任务/消息脱敏与权限校验（RBAC / 工作区隔离），不在用户可见视图泄露内部凭据。
- 心跳接口沿用现有 API Token / JWT 鉴权，避免未授权节点上线。

---

## 12. 验收标准（AC）

- AC1（改前对照）：改动前，群聊 `@Cursor` 在 `agents` 表未命中后落到项目总设计师（默认内部 Agent），走 LLM 编排，产生的是内部编排步骤而非节点派发步骤。
- AC2（改后路由）：改动后，群聊 `@Cursor` 命中 `integration_nodes` 节点名，任务经 `dispatch_task_to_node` 派发到 Cursor 节点，任务步骤出现 `integration_dispatch:cursor:Cursor`，且最终状态为 `completed`。
- AC3（真实执行）：`CursorBridge.execute` 在 `prepare_task` 后轮询 `output.md`，当 `output.md` 非空时读取其内容回填为任务结果；`output.md` 为空且超过 `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS`（默认 600s）则判失败。
- AC4（留痕）：超时 / 结果事件写入任务目录 `events.jsonl`，可供审计与排查。
- AC5（Docker 共享）：`docker-compose.yml` 增加 `./data/bridges:/app/data/bridges` 后，容器内生成的 `data/bridges/workspace-*/Cursor/task-*` 目录对宿主机可见，与数据库 named volume 互不干扰。
- AC6（心跳 / 在线）：宿主 `bridge/cursor_client.py` 每 ~10s 发心跳，前端 Software Dock 实时显示 Cursor 节点 online。
- AC7（宿主驱动 IDE）：宿主桥接客户端发现新任务目录后，`E:/cursor/resources/app/bin/cursor <task_dir>` 打开 Cursor IDE（PROMPT.md 已就位），用户在 IDE 写出 `output.md` 后被标记处理完成。
- AC8（前端菜单）：群聊 MentionMenu 合并展示外部节点，选中插入 `@Cursor` 文本。
- AC9（后续标注）：Codex / Trae / Antigravity 在前端 / 文档中明确标注为 P2 / 未来；本轮仅 Cursor 打通「受控 IDE 节点 + 文件系统桥接」。

---

## 13. 里程碑

| 阶段 | 内容 | 产出 |
|------|------|------|
| M1（P0） | 后端 @ 路由：MessageHub 在 `agents` 表未命中后按工作区查 `integration_nodes` 精确匹配并 `dispatch_task_to_node` | 群聊 `@Cursor` 派到节点，产生 `integration_dispatch:cursor:Cursor` 步骤、最终 completed |
| M2（P0） | 后端桥接真实执行：CursorBridge 轮询 `output.md` 非空回填、超时判失败、写 `events.jsonl`；Docker bind mount `./data/bridges` | 容器内任务目录对宿主可见；执行结果可回写 |
| M3（P1） | 宿主桥接客户端 `bridge/cursor_client.py`：心跳 + 轮询 + 调用 Cursor 打开任务目录 + 标记完成 | 软件 Dock 实时在线；IDE 受控执行并产出 output.md |
| M4（P1） | 前端 MentionMenu 合并外部节点，选中插入 `@Cursor` | 群聊可点选外部节点派活 |
| M5（P2 / 未来） | Codex / Trae / Antigravity 真实执行（Codex 可复用宿主 `codex exec` 无头执行） | 多外部节点桥接生态（本轮仅打标） |

---

## 14. 风险与待定项

### 风险

- **bridges 目录从 volume 迁到宿主路径**：本轮将任务目录由数据库 named volume 体系改为宿主可见的 bind mount `./data/bridges`，需确认容器内写入路径与宿主 `E:/Agents/data/bridges` 对齐，并避免与现有数据库 volume 冲突（两者共存、互不影响）。
- **以 `output.md` 非空作为完成判定**：空文件 / 仅空白字符 / 半截写入可能造成误判或提前回填；需明确「非空」的边界（如去除首尾空白后长度 > 0），并在宿主侧确认 IDE 写盘完成后再标记。
- **轮询延迟**：容器侧轮询 `output.md` 与宿主侧 IDE 写盘存在延迟窗口，用户体验受 `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 与轮询间隔共同影响；间隔过短增加 IO、过长增加等待。
- **Docker 隔离约束**：容器无法访问宿主二进制与 `127.0.0.1` 宿主服务，因此 Cursor / Codex 不能在容器内无头执行，必须依赖宿主桥接客户端——若宿主客户端未运行，节点虽 online 但任务无法推进，需有降级 / 提示。
- **心跳失联**：宿主客户端异常退出后节点可能长期显示 online，需服务端对心跳过期做 stale 判定。

### 待定项

- `BRIDGE_OUTPUT_POLL_TIMEOUT_SECONDS` 的默认值 600s 是否覆盖大任务场景。
- Cursor 二进制路径是否随安装位置变化（需可配置而非硬编码）。
- Codex / Trae / Antigravity 的具体桥接协议与执行方式（P2 阶段细化）。

---

## 15. 与现有系统的关系

本 PRD 建立在「外部 Agent 软件接入」（C-118 / C-129）基座之上：

- `integration_nodes` 表、`Bridge` 适配器框架、Cursor Bridge、Codex CLI Bridge、动态 Software Dock 已在 C-118 实现。
- C-129 补全了任务回写 TaskStep、节点负载统计、审计日志、Bridge 目录契约统一。
- 本 PRD 补齐的是：**群聊 @ 路由到 `integration_nodes` 的精确匹配派发**，以及 **`CursorBridge` 从桩到真实文件桥执行**（轮询 `output.md`、宿主客户端驱动 IDE、Docker 共享目录）。

---

## 16. 实施状态（方案已定，待落地）

- 方案已确定：方案 B（文件桥，Docker 友好），见 §5。
- 待落地项：FR1–FR10 全部（见 §6 优先级 P0 / P1 / P2）。

---

## 17. 结论

外部节点接入的关键不在「再写一套执行引擎」，而在把已有 `integration_nodes` 与 Bridge 框架真正打通两条链路：**群聊 @ 路由到节点** 与 **以共享目录为桥、由宿主客户端驱动外部 IDE 受控产出 `output.md` 回写**。借助 Docker bind mount 让容器与宿主共享任务目录、用纯标准库宿主客户端规避容器内二进制不可达的约束，即可让 Cursor 在本轮作为「受控 IDE 节点」无缝接入群聊派活流程，并为 Codex / Trae / Antigravity 的后续桥接预留清晰边界。

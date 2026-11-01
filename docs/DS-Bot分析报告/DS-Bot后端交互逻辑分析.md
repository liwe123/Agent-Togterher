# DS-Bot 后端逻辑与交互机制分析（改造 Agent Console 用）

> 分析对象：本地已解包的参考实现 **DS-Bot**（dsh 插件，v0.1 系）。
> 证据根目录：E:/Agents/.tmp/dsbot/package/
> - 宿主逻辑：src/host/*.js（46 个模块，本报告主体）
> - 客户端产物：client.js（由 src/client 构建）
> - 文档：README.md（32KB，机制说明与设计意图）
> - 入口：index.js（模块安装顺序）
>
> 引用格式统一为 **文件:起始行-结束行**（相对 src/host/，除非另注路径）。行号以当前解包版本为准。

---

## 0. 阅读约定与总体判断

**DS-Bot 的架构本质**：它把"多 Agent 协作"实现在 **dsh 的 Session 之上**，而不是另造一套运行时。每个 Bot = 一个长期存活的 root Session；群聊 = 一个只负责 relay 的 Session + 每个成员在该群里的一个隐藏 Session；"调度器"不是独立进程，而是**群聊 Session 里的一个工具调用**（group_relay，groups.js:574-679）在事件循环里串行跑一个 round。

由此产生 4 条对 Agent Console 最有价值的结论：

1. **状态机是显式的**：round.slots 的 10 种状态、handoff 的 open/results 树、memory 的 cursor，全部落盘在 state.json / *.json / *.sqlite 里。任何时刻可恢复（resume.js、parts.js:817-836）。
2. **一切"并发"都被刻意串行化**：群里一次只有一个 speaker（groups.js:455-572）；群内 relay 有硬上限（groups.js:39-40）；Bot 间消息用 work 树把扇出收敛回收敛（handoffs.js:99-128）。
3. **上下文是被主动治理的**：dsh 自带压缩被**拦截禁用**，改由 DS Bot 的 steward 二选一决策（switch 新 part / compact 原地 checkpoint），parts.js:277-341 + 566-618。
4. **协议极其克制**：一个 POST /api/bot 端点 + 一个 SSE feed + revision 轮询；错误码只有 6 个（channel.js:19-22, 98, feed.js:1-9）。

**对 Agent Console 的适配性判断**：Agent Console 已有 Task/TaskStep/Message/Conversation/Agent + orchestrator 多阶段流水线 + WebSocket 事件总线，语义上等价于"一次任务 = 一次多 Agent 协作"。缺的正是 DS-Bot 的四件事：**群聊回合调度、交接工作树、记忆三作用域、上下文治理**。第 9 节给出逐条可落地清单。

---

## 1. 运行时总览

### 1.1 运行时对象 rt 与模块装配顺序

index.js:44-55 定义插件 id 与注入服务；index.js:51 的 MODULES 数组决定"监听器与工具按注册顺序生效"：

~~~
diagnostics, store, models, providers, permissions, turns, handoffs, requests,
delivery, roster, folders, agents, prompt, timeContext, tools, chatIndex, groups,
approvals, resume, memory, parts, images, avatarLibrary, secrets, connectors,
capabilities, schedules, browser, browserPlugins, usage, update, dshUpdate,
thinking, feed, channel, relay
~~~

关键约束（index.js:47-50 注释）：**usage 排在最后**，因此它在所有会改写请求的监听器之后才计量。每个模块的 install(rt) 把公共函数挂到 rt 上，模块之间只在运行时通过 rt 互相调用。

改造启示：Agent Console 的"模块装配顺序"等价物是 FastAPI 的 router 注册顺序 + lifespan 钩子；DS-Bot 的做法提示我们**把"计量/观测"放在链路末端**，避免被重试或改写重复计数。

### 1.2 持久化布局（README.md:220-236 与各模块常量）

| 位置 | 内容 | 证据 |
|---|---|---|
| state.json | 团队全量：bots/rooms/exchanges/works/questions/views/works/requests/switching/prefs/revision | store.js:21-22 |
| group-lines/<roomId>/<seq>.txt | 超长群消息的完整正文（成员可读 20000 字符） | groups.js:140-160, constants.js:27-34 |
| handoff-results/<id>.txt | 超过 2000 字符的交接结果全文 | handoffs.js:30-38 |
| chat-index.sqlite | FTS5 全文索引（trigram），重建无损 | chat-index.js:103-113 |
| usage.sqlite | 用量账本 calls/marks/owners/kinds | usage.js:141-153 |
| memory/ | bots/<id>、groups/<id>、team/、journal.jsonl、snapshots/、summaries/、reviewed.json、archive/ | memory.js:1-25 |
| inflight.json | 重启前未完成的 turn 与未取走的投递 | resume.js:96-107 |
| state.lock | 单写者锁（pid+host+mtime 心跳），另一宿主只读 | store.js:45-64 |

**写入策略**：state.json 每次全量写（store.js 的 save 串行队列），因此所有"大文本"都被裁剪：TEXT_KEPT=2000（constants.js:27）、group 行 20000（constants.js:29）、消息内联上限 MESSAGE_INLINE_MAX=20000（constants.js:34），超出走文件（handoffs.js:43-60, delivery.js:130-143）。

改造启示：SQLite/PG 下不必全量重写，但**"热状态文件 + 冷文本文件 + 派生索引"三层结构**值得保留：热状态给调度器用，冷文本给模型读，索引给检索用。

### 1.3 会话拓扑（最重要的结构认知）

~~~
Bot 的私聊：chatOf(botId) = bot.id（就是一个 Session）
Bot 在群 G 的隐藏会话：room.sessions[botId]（首次在该群发言时创建）
群 G 自身：room.id 是一个 Session，prompt 只有一句"调 group_relay"（prompt.js:56-63）
每个会话的历史分片：bot.segments[] / room.segments[botId][]（parts.js:345-354）
~~~

- 群 Session 不接模型：prompt.js:57-63 明确"你只是 relay，不是参与者，收到用户消息就调用一次 group_relay，然后空回复"。
- 成员群会话标题为 "成员名 · 群名"，工作目录由 workDirOf({botId, roomId}) 决定（groups.js:198-228）。
- **群不会读到 Bot 的私聊**：私聊内容只能通过 read_own_chat 工具显式拉取，且群里会留一条 lookup 记录（groups.js:702-711）。

---

## 2. 群聊发言调度（核心机制）

### 2.1 一轮（round）的生命周期

**触发**：群 Session 收到一条 user/message → turns.js:442-469 判断 source 类型 → 投递到 roomInbox 队列 → 下个 turn 调 group_relay（groups.js:579-679）。

**开局**（groups.js:586-644）：

1. 取 roomInbox 里所有排队消息（groups.js:586-588）；一条都没有时用 [{text:''}] 占位（589）。
2. startSeq = min(room.seq+1, 各消息已写入的 logged seq)（590）——保证"已经写进 log 的 bot 发言仍属于本轮"。
3. 逐条写入 log（595-605）：图片 OCR 结果拼进正文，文件跟随行。
4. releases 判定（609-610）：用户写了消息或点了 Continue → room.relays=0（Bot 间接力计数清零）。
5. 选 opener（opener 决定本轮谁开口，615）：跳过纯事件消息、跳过"发帖但谁都没 @ 的成员"。
6. 构造 round 对象（625-644）：

~~~
{ roomId, members, startSeq, kickoff?, references?, shown:[],
  slots:[{id,name,status:'waiting',origin:'user'|'bot',note?,by?,done?}],
  soleAdmin?, speaking:null, replies:[], passed:[], failed:[], started:[] }
~~~

7. rt.roomProgress.set(callId, round)（661）——这是给 UI 实时查"当前谁在说"的唯一入口。
8. runRound（663）；结束时若 signal.aborted 则对每个还在跑的 turn 调 stopRoomTurn（669-671）。
9. reportBack 的帖子在轮末回传给发帖 Bot（673-675）。

### 2.2 候选顺序：谁开口（openingSpeakers，groups.js:771-788）

判定顺序（严格按代码）：

| 条件 | 结果 | 行号 |
|---|---|---|
| opener.kickoff（新建群的开场） | 只 admin | 775 |
| opener.resume（Continue） | 空（由 resumePaused 补 slot） | 777 |
| opener.quiet（成员无 @ 的进度帖） | 空 | 778 |
| opener.done（某成员的活干完了） | 只 askedBy（当初托付它的那个成员） | 779 |
| @all 或 @names | 命中者（排除自己）；@all 仅在 admin 说时展开为全体 | 780-785 |
| opener.progress（成员的进度帖且有 @） | 命中的成员 | 782 |
| opener.late（迟到的结果） | 命中者，否则 askedBy | 783 |
| opener.member（普通成员发帖） | 只命中者 | 784 |
| found 非空且非 all | 命中者 | 785 |
| 默认 + mode=admin + 有 admin | 只 admin | 786 |
| 默认 + mode=everyone | admin 优先，其余按 roster 顺序 | 787 |

补充：**@all 只有 admin 能触发全体**（groups.js:544-551：leads = isAdminOf，callees = leads&&all ? 全体 : found）。

### 2.3 槽位推进：一次一个（runRound，groups.js:455-572）

- 循环条件：index < slots.length **或** inbox 还有待发消息（458）——保证回合末尾到达的用户消息仍被本轮吸收。
- 每轮先 drainRoomInbox（460）：把用户在本轮运行期间发的消息写进 log 并插到当前 index 之前（436-453），重置 relays、恢复 paused。
- 成员被移除/已删除 → slot.status='left'（465-468）。
- **relay 上限**（469-487）：slot.origin==='bot' 时，若 room.relays >= relayLimit(room) 则 slot.status='paused'，加入 room.paused 与 round.parked，**不丢弃**。
- 取/建隐藏会话（491-505）：失败 → status='failed' + round.failed，本轮继续。
- 组装 prompt（507-512），room.seen[memberId] 在投递成功后推进（334）。
- 结果归类（514-541）：

| 返回 | slot.status | 附带 |
|---|---|---|
| {failure} | failed | round.replies 里一条 kind:'failed' |
| {approval:true} | waiting-approval | kind:'approval' |
| {working:true} | working | kind:'working' |
| 有正文 | posted | 写入 log + replies |
| 空/PASS | passed | round.passed；missed 时再写一条 notice |

- **callMembers 插队规则**（groups.js:382-394）：被 @ 的成员如果还在 slots 里 waiting，就**移动到调用者后面第一位**；如果已经发过言，就**再给一次发言机会**（新 slot）。多个 callee 依序插入。
- 轮末收尾：soleAdmin 且无人作答 → 写 admin-passed notice（553-563）；有 parked → 写 paused notice（564-571）。

### 2.4 成员在群里看到什么（roomPrompt，groups.js:229-264）

prompt 由 7-9 个块拼成，顺序固定：

1. Members 行：用户、其他成员（标 admin）、自己（标 admin）+ 说话规则（244）。
2. Group notice（群公告，245）。
3. adminNote（仅当自己是 admin，117-121）。
4. Earlier in the group（本轮之前、自己未见过的行，最多 8 条，253）。
5. This round so far（本轮、自己未见过的行，最多 24 条，254-256）。
6. 引用的会话（referenceNote，257）。
7. 谁还在忙（workingIn + unreadCount，258）。
8. **Speaking order for this round**（slotLabel 序列）+ "你是第 N 位/共 M 位"（259-260）。
9. ROOM_REPLY 固定指令（102）。

这套设计的意图（groups.js:4-18 注释）：让成员**不必数行数就知道自己位置**，且"没人回答一个已经走掉的群"。

### 2.5 PASS 语义

- isPass（groups.js:81）：空串，或匹配 /^\s*[[【(（]\s*pass\s*[\]】)）]/ 或 /^\s*pass\s*[.。!！]?\s*$/i。
- 成员回复先 stripOwnName 去自名（80），再判 PASS。
- PASS → slot.status='passed'，**不写 log**，只记 round.passed（531-533）；round 结束时报告"Stayed silent: …"（978）。
- 例外：如果本轮它已经说过话（said 非空），即使最后是 PASS 也记为 posted（528-530）。
- 迟到回复里 PASS + 已展示过 + 有 askedBy → 用 done 事件通知委托人（833-843）。

### 2.6 隐藏会话隔离与"已读位点"

- room.seen[botId] = 该成员已读到的 room.seq（groups.js:52-56、334）。
- unseenLines：无记录 → 最近 12 条（ROOM_FIRST_LOOK）；否则取 seq > seen 且**不是自己的行**，最多 24 条（52-56）。
- 推进时机：**deliver 成功之后**（334），投递失败不推进（注释 302-304）。
- 成员被移除再加入：删除 seen，重新建会话（roster.js:512-516）。
- 私聊内容进群只有一条路：read_own_chat（groups.js:682-735），调用时写一条 kind:'lookup' 的 log 行（706），并在所有 running round 的 replies 里推一条（707-709）。

### 2.7 群消息读写上限（速查）

| 常量 | 值 | 含义 | 证据 |
|---|---|---|---|
| ROOM_LOG_MAX | 60 | 群 log 只保留最近 60 行 | groups.js:31 |
| ROOM_FIRST_LOOK | 12 | 新成员首次看到 12 行 | groups.js:32 |
| ROOM_DELTA_MAX | 24 | 单次最多补 24 行 | groups.js:33 |
| ROOM_EARLIER_MAX | 8 | 上一轮的"上下文"最多 8 行 | groups.js:34 |
| ROOM_READ_MAX | 30 | read_group_chat 一次读 30 行 | groups.js:126 |
| GROUP_LINE_READ | 20000 | 成员读单行的上限（文件里存这么多） | constants.js:29 |
| TEXT_KEPT | 2000 | state.json 里单行保留的字符数 | constants.js:27 |
| ROOM_REPLY_TIMEOUT_MS | 240000 | 成员 4 分钟不发声 → missed | constants.js:38 |
| ROOM_WORK_GRACE_MS | 15000 | 开始调工具后 15 秒让轮次先走 | constants.js:74 |
| ROOM_STEP_GAP_MS | 30000 | 工作期间的碎句 30 秒合并成一条 | constants.js:40 |
| ROOM_MAX_MEMBERS | 12 | 群成员上限 | constants.js:56 |

### 2.8 回合中断与恢复

- **用户停止**：exec.signal.aborted → 对 round.started 里的每个 turn 调 stopRoomTurn（groups.js:669-671）；turns.js:108-121 会 cancel 对应 Session，或把还在 inbox 的消息摘掉；并把 exchangeId 放进 stoppedRoomTurns（上限 200），turn/end 时据此**不把内容发到群里**（turns.js:625-636）。
- **超时 missed**：roomTurn 内 touch() 每次 Session 事件重置 4 分钟定时器（315-319、327），到期 finish({missed:true}) → slot='missed'，写 notice（534-540）。
- **工作中放行**：work() 在首次非"快速工具"调用后 15 秒触发 {working:true}（320、371-376），轮次继续；成员之后的结果走 lateRoomReply（833-844）。
- **等待审批**：waitsForApproval → {approval:true}（336），approvals.js:15-48 把隐藏会话的审批请求接管，回答后流程继续。
- **重启恢复**：resume.js:1-11 描述——inflight.json 记录"正在跑的 turn"和"已投递未被取走的消息"，下次启动补一次；turn 已在日志里结束的，用回答补发给等待方，**不重发请求**。群里的 resumed/cut 事件写成 log 行（groups.js:652-658）。
- **丢失会话**：deliver 抛 session/not-found 或 corrupt → retireGroupSession，下次重建（groups.js:339-349、130）。

### 2.9 relay 上限与"暂停/继续"

- 默认上限 = 3 × 成员数（groups.js:39-40），可由用户设为 1..200（roster.js:478-486）。
- 计数只在 slot.origin==='bot' 时 +1（groups.js:486）；用户说话或 Continue 重置为 0（609-610、957-960）。
- 超限不丢调用：写入 room.paused，轮末发 paused notice（564-571），并告诉用户"等用户继续或在此发言后解锁"（noticeText 63）。
- Continue（groups.js:955-968）：写一条 role:'resume' 的 source → relay 用空 post 开局 → resumePaused 把 paused 追加到 slots 末尾（400-412）。

### 2.10 成员工作期间的"碎句"（step lines）

- 群成员每个 assistant/message 都会被 showSteps 检查（turns.js:192-199）。
- rt.roomStepText（groups.js:889-909）：同一会话的行累积；满足以下任一条件立即 flush：本轮第一次且 role='room'、包含 @调用、距上次 >= 30 秒；否则定时器等 30 秒。
- flush 后 postStep（858-873）：若该成员仍持有本轮槽位 → waiter.say（进入本轮 replies）；否则若群里有别的 round 在跑且无 @ → 直接进那个 round；否则 postToRoom 开一个新 relay（progress/quiet 标记）。
- turn/end 时 takeRoomSteps 把没发出去的行并入最终回复（turns.js:580、593；groups.js:901-909）。

---

## 3. Bot 间消息与交接（handoff）

### 3.1 message_bot 工具（tools.js:141-267）

参数：to / message / reply_to(me|user) / when(now|queue) / request_id。

语义分支：

| 场景 | 行为 | 行号 |
|---|---|---|
| 在群会话里调用 | **不发私聊**，改为在群里写 "@Name 消息"（callInGroup 130-134），并受群成员限制（groupRefusal 124-128） | 200-205 |
| 目标不在群 | 拒绝并提示"把工作留在群里" | 127 |
| 目标是自己的上游 | 拒绝："它在等你的结果，你的回答会自己送到" | 213-216 |
| 本轮已用 post_to_group @过它 | 拒绝：一件事只能走一条路 | 206-208 |
| 目标有未读的同工作请求 | **合并**（merged:true），复用 exchangeId，去掉旧的 inbox 消息 | 223-237 |
| reply_to=user | 不建 work，加 audience:'user'，目标在自己私聊里回答用户 | 218-219、240 |
| when=now 且目标在跑 | steer（在下一步插入） | 235 |
| when=queue 或 reply_to=user | followup（排队到下一轮） | 235 |

返回值是**回执文案**，不是结果：明确告知"回复稍后作为新消息到达，不要等待"（245-263）。

### 3.2 交接工作树（handoffs.js）

state.works 的结构（handoffs.js:99-104）：

~~~
works[workId] = { from, to, room?, parent?, open:[childIds], results:[{id,name,text,length?,file?}], at, held? }
~~~

核心规则：

1. **openWork**（99-104）：请求发出时建立，parent 用于把扇出挂到当前工作之下。
2. **closeWork**（108-128）：被请求方给出答案时关闭；把答案（超长则先落盘）push 到 parent.results；没有 parent 说明是顶层，直接回给发起 Bot。
3. **takenWork**（142-147）：结果被某个 turn 真正读走后从 open 里移除。
4. **答不上报的条件**：rt.waitsWork(work) 为真（还有子工作在跑）→ holdWork 暂存（151-156），等全部回来再一起上报（turns.js:611-623）。
5. **answerText**（163-173）：最终上报 = 自己最后说的话（或 held）+ "[Handed back to …]" + 每个子结果（带截断提示）。
6. **upstreamOf**（176-186）：沿 parent 链收集所有"在等我的"Bot，用于拒绝消息成环。
7. **waitingView**（199-209）：给 UI 的"某 Bot 在等谁"视图。
8. **statusOf**（219-263）：给其他 Bot 看的自然语言状态（工作中/等审批/等交接/有新消息未读/私聊有卡片未答）。

### 3.3 长结果落盘（handoff-results/）

- 触发条件：结果长度 > TEXT_KEPT(2000) 且可写（handoffs.js:43-60）。
- 文件名：workId（UUID）或它的 sha256，扩展名 .txt（34-38）。
- 写入顺序：先写临时文件再 rename，**先落盘后写 state**（41-42 注释）。
- 读取：resultText（78-91）内存优先 → 文件 → 只有开头（标记 whole:false，附带"[cut; N characters in all]"）。
- 清理：当引用它的 state 已经不再指向它时删除（63-73）；closeWork 在 save 成功后才删旧结果（124-126）。

### 3.4 长消息本身也走文件（delivery.attachLong）

- 超过 MESSAGE_INLINE_MAX(20000) → 用 dsh attachments 存成一个文件，消息正文只保留 1000 字符 + 一行提示（delivery.js:130-143）。
- 文件以 file block 随消息发送，接收方用文件工具读（delivery.js:95-101）。
- 群里的长帖同理（tools.js:582-583、groups.js:811-815）。

### 3.5 投递与 exchange 记录（delivery.js:54-106）

- 消息头由 headerFor 生成（17-37），把"这条消息是什么"讲清楚：Reply from / Message from / Group chat / Stopped by / 重启后继续 / 上次把工具调用写成文本 等 9 种前缀。
- EXCHANGE_ROLES = request/reply/stopped 会写入 state.exchanges（80-90），长文本只存前 2000 字符 + 指向 Session 的指针，供 UI 的"Bot 对话记录"回读（exchangeText 111-125）。
- steer vs followup：目标正在跑 → steer（下一步插入）；否则 followup（104-106）。

### 3.6 UI 事件推送

三条通道并存：

| 通道 | 内容 | 证据 |
|---|---|---|
| POST api/bot {endpoint:'state', since:revision} | 全量/增量团队视图 + live（activity/work/memoryNews/connectors） | channel.js:146-152、88-95 |
| room-progress | 某群当前 round 的 replies/speaking | channel.js:225-226 |
| SSE /api/bot/feed | revision / live / message / stream 四种事件 | feed.js:1-9、34-57、62-88 |

客户端默认用 1.5 秒轮询（隐藏页 10 秒），并在 revision/modelsKey 未变时短路（client.js:19435-19476、19493）。**注意**：这是"轮询 + 版本号"，不是纯推送；桌面端才用 SSE。

---

## 4. 记忆体系

### 4.1 三作用域与目录

memory.js:1-25 定义：bots/<botId>/、groups/<roomId>/、team/，各自一个 MEMORY.md + 若干 topic 文件。另有 journal.jsonl（变更日志）、snapshots/（每个 Session 冻结的段落）、summaries/（面板摘要）、reviewed.json（review 游标）、archive/（删除归档）。

**读写权限**（memory.js:691-708）：

| 作用域 | 读 | 写 |
|---|---|---|
| 自己的 | 自己 | 自己 |
| 群 | 该群成员（且只在该群的会话里） | 该群成员 |
| 团队 | 所有 Bot | 仅 Main Bot 与群管理员 |
| 别人的 | 仅 Main Bot | 仅 Main Bot（用户要求时） |

### 4.2 Markdown 格式

- 一条记忆 = 一行 bullet，结尾带元数据：[source: …; added: …]（memory.js:88-104）。
- 元数据键值对解析用正则（47），值里禁止 ; [ ] 换行（100）。
- MEMORY.md 有 ## Index 段，列出 [[topic]] 链接（157-175）。
- 其它非 bullet 行（标题、手写说明）原样保留（118-141）。

### 4.3 限额（memory.js:41）

| 项 | 上限 |
|---|---|
| 单条 entry | 300 字符 |
| MEMORY.md | 4000 字符 |
| 单个 topic | 16000 字符 |
| 一个作用域的 topic 数 | 40 |

超限**不是静默截断**，而是抛错并给出"怎么腾地方"的建议（memory.js:724-731）；文件已经超限时允许缩小（727）。

### 4.4 写入路径（统一收口）

所有写入（工具、review、面板）都走 addEntry / replaceEntry / removeEntry（memory.js:749-843）：

1. queued() 串行化（一次一个写）。
2. recoverPending() 先补完中断的写。
3. writable(scope, actor) 鉴权。
4. 重读文件 → 修改 → checkSize → publish({op, scope, steps, row})。
5. publish 写文件 + 追加 journal 行（before/after）。

journal 行结构（memory.js:774、809、838）：{id, time, op, scope, file, actor, actorName, before, after, removedTopic?}。

### 4.5 安全闸门

- looksLikeKey（memory.js:189-208）：10 类已知 key 格式 + "长串混合大小写数字"启发式。
- looksSecret（225-229）：key、密码句式（中英）、证件号、15 位以上连续数字。
- 还会先跑 rt.redactSecrets（712），命中即拒写，提示"key 请用 request_secret"（717）。

### 4.6 三个工具

| 工具 | 参数 | 关键行为 | 证据 |
|---|---|---|---|
| remember | text, replace?, topic?, scope? | 有 replace 则替换命中的那条；否则新增；已存在完全相同的条目不重复写 | memory.js:1097-1129、749-779 |
| forget | entry, topic?, scope? | 按文本子串匹配；匹配多条则报错要求更精确；topic 空了连链接一起删 | 1131-1152、782-791、816-843 |
| recall | query?, topic?, scope? | 无参=列清单；有 topic=整篇读；有 query=按词命中共现，全部命中优先，否则按命中数排序，最多 30 条 | 1166-1223 |

写入的元数据由 metaFor 生成（memory.js:1056-1060）：source（part N #seq 锚点或"group X 时间"）、by（替别人写时）、added（日期）。**source 里的锚点能被 read_own_chat 打开**，形成"记忆 → 原始对话"的可追溯链。

### 4.7 memory review（自动记忆流水线）

这是 DS-Bot 记忆体系的关键设计：**不依赖 Bot 主动调用 remember**。

- 触发：agent/status 变 idle 后延迟 2 秒（memory.js:1703-1735、60），同一会话的多次 turn 合并为一次。
- 输入（chatBatch 1450-1475 / groupBatch 1479-1499）：从游标（reviewed.json）往后读；首次 review 至少读 6 行且要读到用户的最新一句；群聊从 log 读（因为成员 Session 里是包装过的轮次提示）。
- 只保留"用户说的话"才值得调用模型（memory.js:1628）：read 里没有 user 行就直接推进游标。
- 请求（reviewEntries 261-278 + reviewRequest）：把两个 MEMORY.md 全文 + 相关 topic（按词共现优先、其次按 added 倒序）塞进 16000 字符预算；给模型编号列表，要求返回 {"changes":[{op:'add'|'edit'|'remove', entry?:N, text?, topic?, team?}]}。
- 应用（applyReview 1516-1549）：逐条再过一遍 entryProblem / 权限 / 存在性；**团队写入还要复查权限**（keeper 可能中途被降级）。
- 收敛：一次最多 8 条变更（REVIEW_CHANGES_MAX）；如果模型给满 8 条且确实改了东西，则**同一批语料再读一遍**，最多 4 轮（1651-1661）。
- 失败处理：NO_MATCH/DENIED 忽略，其它失败**不回退游标**，下次重读（1545-1547）。
- 游标只前进（1613、1663-1667）。

### 4.8 prompt 注入与"冻结"

- 注入点：ctx.systemPrompt.section({name:'bot-memory', order:645, interpolate:false, text: ctx => sectionFor(sessionId)})（memory.js:1020-1025）。身份段是 order 640（prompt.js:67-72）。
- 段落结构（memorySection 916-953）：# Your memory / 规则 / 团队规则 / 自己的 MEMORY.md + topics / 团队 MEMORY.md + topics /（群里再追加群记忆段）。
- **冻结**：首次渲染时把整段写入 snapshots/<sessionId>.md 并缓存（sectionFor 970-1012）。理由是"prompt 缓存要字节稳定"（1-25 注释）。
- 解冻时机：新 part、checkpoint（renewMemory 1014-1018；parts.js:645）、角色改变（978-981 会检测段落里的标记是否仍匹配）。
- 读取失败不会让 turn 失败：段落里显示"(this memory could not be read: …)"（899-908）。

### 4.9 记忆面板 API

三个 endpoint（memory.js:1737-1742），由 channel.js:372-376 转发：

| endpoint | 作用 |
|---|---|
| memory-view | 返回 entries（scope/topic/text/added/by/source）、sizes、limits、summary、fresh、summarizing；可带 regenerate/summarize |
| memory-ask | 一次模型调用，"问它记得什么"或"告诉它改什么"，改动走同一套写入路径 |
| memory-forget | 面板里点删除（两次确认） |

摘要缓存（memory.js:1294-1345）：hash = sha256(language + 所有条目)，变了才重写；失败会记住 (hash, model) 避免每次轮询都重试。

---


## 5. 上下文治理（checkRatio → steward → checkpoint / 新 part）

### 5.1 三条线怎么算

steward.js:20-27：

~~~
usable = max(window - reserve, floor(window/2))
hard   = floor(usable * 0.95)
check  = min(floor(usable * checkRatio), hard)
~~~

- window 来自模型声明的 contextWindow；未声明 → 500000（steward.js:12）。
- reserve = 该路由的 maxTokens（回复预留）。
- checkRatio 默认 0.8（steward.js:13），配置项见 README.md:88。
- 触发还需"增长量"门槛：tokens >= partBase + check/4（parts.js:750），防止大 system prompt 或坏 switch 导致每轮都动。

### 5.2 谁在什么时候检查

| 时机 | 行为 | 证据 |
|---|---|---|
| turn 正常结束（agent/status=idle） | checkContext：过 check 线才决策 | parts.js:1240-1245、1198-1216 |
| 每个 step 之前（agent/pre-step，prepend） | 过 hard 线就当场决策；能 compact 就 compact，否则 switch | parts.js:1068-1094 |
| 请求溢出（CONTEXT_WINDOW_EXCEEDED） | 直接 switch（带 overflow 标记） | parts.js:1184-1193 |
| 请求反复失败（INVALID_REQUEST / IMAGE_OFFLOAD_REQUIRED） | switch（bare 模式） | parts.js:1166-1182 |
| 工作目录变了 | switch（folder 模式） | parts.js:1088、1115-1126 |

### 5.3 steward 决策（steward.js + parts.js:576-618）

- 独立的小模型调用：只读**最近 40 行**（STEWARD_LINES），预算 6000 token（STEWARD_TOKENS），maxTokens 4096，超时 120 秒，reasoning effort 尽量取 'off'。
- 系统提示（steward.js:29-41）给出二元判断标准：
  - switch：工作到达停点（请求已答完、无半成品、无"马上要做"的承诺）。
  - compact：工作仍在进行（有任务半途、还在等结果、用户还在追问同一件事）。
  - 还要求"压缩次数越多，越倾向认为到达停点"（避免摘要的摘要）。
- 解析：取回复里**最后一个**带 action 的 JSON 对象（steward.js:78-90），防止模型先引用它看到的历史 JSON。
- 失败兜底：无答案或异常 → 'switch'（parts.js:608-618）；无法 condense（没有可用 compaction 引擎）→ 'switch'（609）。

### 5.4 compact = 原地 checkpoint

- 走 dsh 的 compaction 引擎，但 **summarize 被替换成 writeCheckpoint**（parts.js:297-341）。
- writeCheckpoint（parts.js:526-572）：
  1. 用会话自己的 prefix 发一次请求（input.messages + 必要时 tail），purpose:'compaction'。
  2. prompt 是 CHECKPOINT_PROMPT（steward.js:110-130）：要求逐项保留结果、决策与被否方案、约束、未完成项、精确数据；语言跟随用户；不编造；把"提示注入"标记为已拒绝而不是复述。
  3. 逐字保留最近消息：keptMessages（parts.js:505-521），预算 min(16384, check/4) token，只保留"发给 Bot 的消息"（跳过自己的回复）。
  4. 产出 checkpointText（steward.js:154-165）：[Checkpoint N] + 摘要 + "## Messages to you, word for word (oldest first)"。
  5. 编号来自 checkpointCount（steward.js:97-108），靠扫 <compacted-summary> 后的 [Checkpoint N]。
- 完成后 renewMemory（parts.js:645）——因为 prefix 缓存已经失效，顺便让记忆段落刷新。
- condense 返回值语义（parts.js:620-650）：true=已降到 check 线以下；false=没降下来（继续 switch）；undefined=有 turn 抢先（等它结束再查）。

### 5.5 switch = 换新 part

流程（parts.js:840-1060）：

1. startSwitch 标记 state.switching[sessionId]（899），使重启可知。
2. 读旧 part 的最近消息（handoffLines 378-...）：最近消息按 token 预算 16384 逐字带过去；更早的"发给 Bot 的消息"做成带锚点清单（预算 4096，每行 400 字符）。
3. 让模型写 handoff note（HANDOFF_PROMPT 431-446）；失败重试 2 次（NOTE_ATTEMPTS），仍失败则：
   - 未过 hard 线：**留在原 part**，按 60s/300s/900s 退避（NOTE_COOLDOWN_MS 236、964-974）。
   - 已过 hard 线：用上一段的 note 兜底，标记 fallback（975、654-667）。
4. 新建 Session（同标题、同工作目录、同模型、同权限），旧 Session 归档。
5. 把旧 part 记入 segments（996-1002），新 part 写入 handoff 包（1040-1043）：

~~~
[Handoff · part N]
DS Bot moved <where> on to a fresh conversation … because <reason>.
（note 全文）
## Messages to you in part N-1, before the latest ones (oldest first)
（带锚点的消息清单）
~~~

6. 迁移定时任务（schedules.js:129+）、把旧 part 里"未被取走"的输入转发到新 part（parts.js:787-836、1052）。
7. 重启后由 heldBack() 补做未完成的 switch（parts.js:817-836）。

### 5.6 拦截 dsh 自带压缩

parts.js:277-341 用 Symbol 标记原方法，重写 compactIfNeeded / compactNow / compactRegion / summarize：

- Bot 的 Session → 返回 null 或抛"Bot 对话自己腾空间"。
- 非 Bot Session（子代理等）→ 原样放行。

理由（286-287）：只有 DS Bot 知道该 compact 还是 switch。

### 5.7 FTS5 全文索引（read_own_chat 的底座）

- 表结构（chat-index.js:103-113）：

~~~
CREATE VIRTUAL TABLE lines USING fts5(
  text, session UNINDEXED, seq UNINDEXED, time UNINDEXED, who UNINDEXED,
  tokenize = 'trigram');
CREATE TABLE marks (session TEXT PRIMARY KEY, through, keep, sealed, turn);
~~~

- trigram 分词 → 中文无需分词（1-9 注释）；少于 3 字符的词退回 LIKE（25-43）。
- termQuery（25-43）：长词做 FTS5 短语匹配按 rank 排序；短词追加 LIKE 过滤。
- catchUp（136-178）：按 marks.through 增量补索引；读到的历史若有缺口（seq 不连续）直接抛错，不写入半个 part；part 结束 60 秒后 sealed（20-21、153）。
- 三种读法：
  - searchOwnChat（206-232）：全部命中优先，否则按各词命中数加权，最多 20 条，按时间正序展示。
  - latestOwnChat（235-245）：跨所有 part 取最近 12 条。
  - aroundOwnChat（248-259）：锚点 "part 2 #1234"，前后各 6 行，锚点那行最多 8000 字符。
- 锚点格式（181-184）：多 part 时 "part N #seq"，单 part 时 "#seq"。
- **隐藏当前 turn**（194-202）：调用者所在 part 的当前 turn 不参与检索，否则它自己的提问会命中自己。

---

## 6. 权限与角色

### 6.1 四级角色

README.md:16-23 与 roster.js 实现：

| 角色 | 能力 | 关键校验 |
|---|---|---|
| 用户 | 全部 | actorId === undefined 即用户 |
| Main Bot（可多个） | 管理任意群；创建/修改/删除 Bot；写团队记忆；可读改他人记忆；stop_bot | rt.isMain(id)，state.mainBotIds 数组 |
| 群管理员 | 只管理自己那个群（名字、公告、成员、回复模式、admin 转交） | rt.isAdminOf(room, id) 即 room.admin === id |
| 成员 | 在群里发言、@ 他人、从群外 post_to_group 到自己所在的群 | room.members.includes(id) |

### 6.2 校验点清单（对 Agent Console 直接可用）

| 动作 | 允许者 | 证据 |
|---|---|---|
| 创建 Bot | Main Bot | tools.js:312 |
| 改自己 | 本人 | tools.js:353 |
| 改别人 | Main Bot | tools.js:353 |
| 设置浏览器授权 | 仅用户 | roster.js:251-253 |
| 改群（任意群） | 用户 / Main Bot / 该群 admin | roster.js:452-455 |
| 改群的工作目录 | 用户 / Main Bot | roster.js:474 |
| 改群的权限预设 | **仅用户** | roster.js:476 |
| 改群的 relay 上限 | **仅用户** | roster.js:480 |
| 让群没有 admin | 仅 Main Bot（admin 自己必须转交） | roster.js:463-470 |
| 删除群 | Main Bot | tools.js:546 |
| 删除 Bot | Main Bot 不能删（先摘掉 Main Bot 角色） | roster.js:613 |
| 写团队记忆 | Main Bot / 群管理员 | memory.js:703-708 |
| 读别人记忆 | Main Bot | memory.js:1156-1163 |
| stop_bot | Main Bot | tools.js:280 |

设计要点：

- **权限只能由用户设置**（Bot 不能提权），错误文案直接说 "Only the user can …"。
- **agentId 与 roomId 的双重身份**：同一个 Bot 在私聊与群里是两个 Session，校验时必须先 selfOf(sessionId) 得到 botId（rt.selfOf / groupOwners 映射）。
- **权限预设**（permissions.js）：每个 Bot 一份 preset，每个群可覆盖（room.permission）。'auto'（Auto review）是会话级能力，被显式排除（permissions.js:6、40）。群改预设时遍历 room.sessions 逐个应用（61-77）。

### 6.3 与 Agent Console 权限模型的差异

- DS-Bot 的权限主体是**Bot 与群**，Agent Console 的主体是**User + WorkspaceMembership(owner/admin/member/viewer)**（backend/app/core/permissions.py:14-60）。
- 需要新增"**执行主体 = agent**"这一维度：Agent 发起的行为要按 Agent 角色（main/member）+ 群角色（admin/member）判权，而不是按 workspace 角色。
- 建议：保留 PERMISSION_MATRIX 作为"人对控制台"的权限；新增 AGENT_CAPABILITY_MATRIX 作为"Agent 对协作资源"的权限，两组在同一处判定（详见 9.M11）。

---

## 7. 用量统计

### 7.1 两种数据来源（这是本节的核心设计）

usage.js:1-12 明确：

1. **日志回填**：Session 自己记录的调用（每次 assistant 结算一条）从 log 读，**历史对话也算**。foldCalls（53-93）把事件折叠成"每次计费尝试一行"：
   - request/header、request/context 更新当前 provider/model；
   - llm/retry-started 开始新 attempt；
   - assistant/message 或 assistant/attempt 里的 usage 块（input/cacheRead/cacheWrite/output）；
   - session/end-seed（inherited=true）表示 fork 的继承段，清空之前的行（reset）。
2. **实时计量**：不落在任何 Session 日志里的调用（checkpoint、handoff note、steward、图片 OCR、dsh 标题、compaction），在 llm/stream 里边流边记（579-599）。

这就是为什么 README.md:31 说"老对话也计数，但无日志的调用只从插件运行起计数"。

### 7.2 账本结构（usage.sqlite，usage.js:141-153）

~~~
calls (key PK, session, time, provider, model, kind, live,
       input, cache_read, cache_write, output)
marks (session PK, through, fold JSON, sealed)
owners (session PK, owner, name)
kinds  (session PK, kind)
索引：calls_session
~~~

- key = turn:step:attempt（日志来源）或 live:<uuid>（实时来源）。
- owner 形如 机器人id / room:<id> / agent:<id> / 'other'（usage.js:448-462）。
- kind = turn / group / chat / compaction / memory / other…

### 7.3 聚合口径

- 先按 (session, provider, model, kind, **15 分钟槽**) 求和（usage.js:28、96-106、162）。
- usageView（438-519）再折成 **每小时 × owner × model × kind** 的桶，输出数组：

~~~
rows: [hour, ownerIndex, modelIndex, kindIndex, input, cacheRead, cacheWrite, output, calls]
~~~

- 时区处理（196-214）：按 IANA 时区把 15 分钟槽映射成 "YYYY-MM-DD HH"；前端自己按日/周/月再求和（README.md:31）。
- 扫描（380-435）：4 路并发读 Session 日志，6 秒内没扫完先返回已有数据（VIEW_WAIT_MS 23、441），5 秒内不重复扫（RESCAN_AFTER_MS 24）；已结束超过 60 秒的 part 标记 sealed（26、402-407）。
- 记账时机（536-573）：只有"不属于任何 Session 的请求"才实时计；Session 自己的请求靠 noteSession 记录 owner 归属，用量本身仍从日志回填。

### 7.4 对 Agent Console 的直接价值

Agent Console 已有 ModelCall（models/model_call.py）与 cost_stats 端点。可以补两件事：

- **kind 维度**：把"编排/审阅/压缩/记忆/总结"等非任务调用单独计量，否则成本会全部堆在任务上。
- **owner 解析优先级**：session → agent/room 的显式映射表（含已删除对象的旧名字），保证删了 Agent 之后历史用量还认得出来。

---

## 8. API / 事件协议

### 8.1 唯一的 HTTP 端点

channel.js:571-581 注册 POST /api/bot（ROUTE 常量，constants.js:22）：

~~~json
// 请求
{ "endpoint": "state", "payload": { "since": 12, "models": "…", "locale": "zh-CN" } }
// 成功
{ "ok": true, "value": { … } }
// 失败
{ "ok": false, "error": { "code": "bot/refused", "message": "…", "details": {} } }
~~~

- HTTP 状态**永远是 200**（581），错误在 body 里。
- 错误码只有 6 类：bot/invalid、bot/refused、bot/internal、bot/read-only、bot/not-found、bot/stale（channel.js:14-22 与各 case）。
- isInternal 判定（17-18）：TypeError/ReferenceError/RangeError/SyntaxError 或 E* 系统错误 → bot/internal 并写诊断日志；其余当作"给用户看的拒绝"。
- 只读宿主（另一个 dsh 持有 state.lock）只允许 READS 白名单里的 endpoint（channel.js:98、143-144）。

### 8.2 团队视图（state）

view()（channel.js:38-82）返回**随 revision 变化**的部分：

~~~
revision, workspaceId, mainBotId, mainBotIds,
bots[{…, sessionId, parts:[…], waiting?}],
rooms[{…, relayLimitDefault, parts:[…], preview}],
exchangeTurns, questions, views, btwCards, sideChats, agents,
secrets(仅名字与授权), capabilities, secretRequests,
colors, models, defaultModel, permissions, modelsKey, prefs,
browser, memory, readOnly
~~~

live()（88-95）返回**不随 revision 变**的部分：activity、work{bots,rooms,approvals,waiting,turns,steered}、memoryNews、memoryReviews、connectors、capabilityStatuses。

短路逻辑（146-152）：若 since === revision 且 models === modelsKey，只返回 {revision, unchanged:true, …live()}。这让 1.5 秒轮询非常便宜。

### 8.3 其它常用 endpoint（共 60+ 个）

| endpoint | 用途 | 证据 |
|---|---|---|
| send | 用户发消息（queue 模式，30 秒超时） | channel.js:425-440 |
| room-progress | 群当前 round 的 replies + speaking | channel.js:225-226 |
| room-continue | 解除 paused | channel.js:278-282 |
| create-room / update-room / delete-room | 群 CRUD | channel.js:256-318 |
| answer-question / view-reply | 卡片作答（先占位再入队，防重复） | channel.js:377-424 |
| usage | 用量视图 | channel.js:222-224 |
| memory-view / memory-ask / memory-forget | 记忆面板 | channel.js:372-376 |
| earlier / chat | 历史分页 | channel.js:205-210 |
| run-stats | dsh 自己的会话统计投影 | channel.js:213-221 |
| approval-answer | 审批卡作答 | channel.js:319-321 |

卡片作答的"先删后投递、失败回滚"（387-397、412-422）很值得借鉴：**用状态删除作为并发锁**。

### 8.4 SSE feed（桌面端推送）

feed.js:1-9、96-113：GET /api/bot/feed，五种事件：

| 事件 | 数据 | 含义 |
|---|---|---|
| hello | {revision} | 连接建立，客户端据此判断是否需要全量拉 |
| revision | {revision} | 团队已保存（stateSaved 触发） |
| live | {} | 工作状态变了但 revision 未变（150ms 合并） |
| message | {botId, sessionId, item} | 某 Bot 私聊新增一条可渲染项 |
| stream | {botId, sessionId, attemptId, phase, text?} | 正在写的回复增量 |

- 背压：队列积压超过 512 条就断开该客户端（16、24-28）。
- 心跳：每 20 秒注释行（11、115-119）。
- 进程内订阅者（relay 连接器）拿到完全相同的事件（32-44）。

### 8.5 状态事件语义汇总（turn / session / group / relay）

| 概念 | 数据形态 | 证据 |
|---|---|---|
| turn | work.turns[sessionId] = 开始时间；work.steered[sessionId] = 用户最后插入时间 | turns.js:308-316 |
| session | bots[].sessionId + parts[]；rooms[].parts[]（成员隐藏会话与其历史段） | channel.js:46-54 |
| group | work.rooms[roomId] = [{botId, since, tool?/said?, speaking?}]；room-progress 的 replies/speaking | turns.js:320-335、channel.js:225-226 |
| relay | room.relays 计数 + room.paused[] + relayLimit(room)；UI 用 relayLimitDefault 展示默认值 | groups.js:39-40、469-487、channel.js:53 |

客户端把 activity 映射成头像动作（turns.js:133-138：sending/searching/working/thinking/orbit），把 work 映射成"正在做什么"的一句话（doingOf 271-285：工具名 + 描述 + 目标文件名/查询词/站点）。

---


## 9. 可迁移清单（DS-Bot 机制 → Agent Console）

### 9.0 概念映射（先对齐再动手）

| DS-Bot | Agent Console 现状 | 建议落点 |
|---|---|---|
| Bot（root Session） | Agent（agents 表） | Agent 增加 is_main / instructions / permission_preset |
| 群聊 room（relay Session + 成员隐藏 Session） | 无 | 新建 groups / group_members / group_messages / group_seats |
| 群 log line | Message（conversations） | group_messages 独立表（seq 单调），或复用 Message + conversation.kind='group' |
| exchange（Bot 间消息） | Message(sender_type=agent) | 复用 Message + 新增 bot_exchanges 索引表 |
| work（交接） | 无（orchestrator 内部阶段） | 新建 handoffs 表，Task 增加 parent_task_id |
| state.json | 19 张表 | 不需要，关系库直接承载 |
| part（会话分片） | Conversation（单条） | conversations 增加 part_index / parent_conversation_id / kind |
| memory 三作用域 | 无 | agent_memories + memory_entries + memory_journal |
| usage.sqlite | model_calls + cost_stats | 复用 model_calls，加 kind/owner 维度 |
| /api/bot | REST /api/v1/* + WS | 新增 /api/v1/collab/* 与 WS 事件 |

**总原则**：Agent Console 不是重写 DS-Bot，而是把 DS-Bot 的**四个状态机**（round / work / memory-cursor / part）移植到关系库与现有 orchestrator 上。DS-Bot 用"文件 + 内存 Map"表达的东西，在 Agent Console 里应当成为**带版本号与行锁的表**。

---

### 9.1 P0（不做则协作语义不成立）

#### M1 群聊领域模型与会话拓扑
- **机制**：群是一等实体（成员、admin、mode、notice、relay_limit、paused），每个成员在群里有独立的隐藏会话与独立已读位点（groups.js:198-228、52-56）。
- **改动落点**：
  - 新模型 backend/app/models/group.py：GroupChat(id, workspace_id, name, mode, admin_agent_id, notice, relay_limit, relay_count, paused_json, created_by, created_at)、GroupMember(group_id, agent_id, joined_at, seat_seq)、GroupMessage(id, group_id, seq, sender_type, sender_agent_id, content, kind, meta_json, created_at)、GroupSeat(group_id, agent_id, last_seen_seq)。
  - Conversation 增加 kind（dm|group_relay|group_member_part）、group_id、agent_id、part_index。
  - Alembic：新 revision（4 张新表 + conversations 3 列，nullable，向后兼容）。
  - 服务：backend/app/services/group_service.py（create/update/delete、成员增删、座位初始化）。
- **优先级**：P0
- **数据与迁移影响**：纯新增，历史 conversations 默认 kind='dm'；GroupMessage.seq 用 (group_id, seq) 唯一索引，插入时在事务内 SELECT max(seq) FOR UPDATE 或使用 PG 序列/sqlite 单写事务。
- **测试点**：迁移 upgrade/downgrade；成员私聊与群会话不互相污染；删除 Agent 时级联清除 GroupMember 与 GroupSeat；同一 Agent 两个群互不可见。

#### M2 回合调度器（一次一个 speaker）
- **机制**：round 对象 + slots 线性推进 + 串行投递 + 每步状态机（groups.js:455-572、382-394、625-644）。
- **改动落点**：
  - 新服务 backend/app/services/round_service.py：`start_round(group_id, opener_msg_id) -> Round`、`next_slot()`、`run_round()`（asyncio 单协程，DB 行锁保护）、`call_members()`（插队/追加）。
  - 新模型 Round(id, group_id, task_id, start_seq, kickoff, status, speaking_agent_id, created_at, ended_at) + RoundSlot(id, round_id, agent_id, status, origin, note, by_agent_id, order_index, started_at, ended_at)。
  - orchestrator：新增 `_run_group_round(task)` 复用现有 `_call_and_log` / `save_task_step` / `send_result_message`；一个 round 对应一个 Task（type='group_round'），每个 slot 对应一个 TaskStep。
  - 互斥：`SELECT ... FOR UPDATE` on GroupChat，或 asyncio.Lock + 数据库 advisory lock（PG）。
- **优先级**：P0
- **数据与迁移影响**：2 张新表；Task 增加 round_id；TaskStep 增加 slot_id（agent_id 已有）。存量 Task 不受影响。
- **测试点**：并发两个用户消息只产生一个 round；slot 状态迁移全覆盖（waiting→speaking→posted/passed/failed/working/waiting_approval/left/paused）；中途删除成员 → left；round 结束 speaking 置空。

#### M3 @提及与 reply mode
- **机制**：统一的 mention 解析（最长名优先、跳过代码块/链接、排除邮箱与路径），@all 只有 admin 能触发全体，普通成员发帖只叫被点名的人（shared/mentions.js:52-71、groups.js:544-551、771-788）。
- **改动落点**：
  - 新模块 backend/app/services/mentions.py：移植 nameProblem / mentionSpans / ALL_WORDS / USER_NAMES / referenceSpans。
  - message_hub.parse_mentions（现 core/message_hub.py:169-180）替换为严格版；_resolve_mention_target 复用。
  - GroupChat.mode（'everyone'|'admin'）、admin_agent_id；openingSpeakers 等价函数放进 round_service。
- **优先级**：P0
- **数据与迁移影响**：GroupChat 两列；Message 可增 meta_json 记录命中的 agent_ids。
- **测试点**：中文名、含空格名、"@docs/guide.md" 不触发、"a@b" 不触发、代码块内不触发、@all 由普通成员发出时只当普通文本、admin 发出的 @all 展开全体。

#### M4 PASS 语义与"沉默也要可解释"
- **机制**：PASS → slot=passed，不写群消息；本轮无人作答且只有 admin → 写一条系统提示；超时 missed 也写提示（groups.js:81、514-541、553-563）。
- **改动落点**：round_service.is_pass()；GroupMessage.kind='notice'（reason=missed/paused/admin_passed）；MessageType 增加 PASS。
- **优先级**：P0
- **数据与迁移影响**：MessageType 枚举加值（字符串枚举，无需迁移列）；notice 行不计入未读。
- **测试点**："[PASS]"、"（pass）"、空串、纯空白；PASS 不产生 message.created；missed 提示只出现一次。

#### M5 群消息读写上限
- **机制**：库保留全文，但**进入模型上下文时**按 20000 字符截断并标注；单轮最多带 24 行新内容 + 8 行上下文 + 60 行 log 窗口（groups.js:31-34、126、179-185；constants.js:27-34）。
- **改动落点**：round_service.build_member_prompt() 里做裁剪；GroupMessage 存全文 + 可选 group_message_bodies（超长正文单独表/文件）；配置项 app/core/config.py 增加 group_line_read_max 等。
- **优先级**：P0
- **数据与迁移影响**：无需改表（若拆正文表则 +1 表）。
- **测试点**：25000 字符消息进 prompt 被截断且带"(cut; N characters in all)"；read_group_chat 等价工具能按 seq 读全文。

#### M6 relay 上限与暂停/继续
- **机制**：Bot→Bot 计数，超过 3×成员数（可配 1..200）就暂停而非丢弃；用户发言或显式继续才解锁（groups.js:39-40、469-487、564-571、955-968；roster.js:478-486）。
- **改动落点**：GroupChat.relay_count / paused_json；POST /api/v1/groups/{id}/continue；WS 事件 group.paused / group.resumed；round_service 在创建 bot-origin slot 前判限。
- **优先级**：P0
- **数据与迁移影响**：2 列，默认 null（用成员数算默认）。
- **测试点**：连续 3 轮 bot 互调后第 4 次暂停；用户发言后计数归零并恢复；暂停期间消息不丢；继续接口幂等。

#### M7 交接工作树（handoff works）
- **机制**：请求即开一个 work，子工作在 parent.open 里；只有全部回来才把合并结果上报给上级；结果被读取后出队；成环拒绝（handoffs.js:99-147、163-186）。
- **改动落点**：
  - 新模型 backend/app/models/handoff.py：Handoff(id, parent_id, from_agent_id, to_agent_id, group_id, status[open|waiting|done|dropped], result_text, result_path, held_text, created_at, closed_at) + HandoffChild(handoff_id, child_id, consumed_at)。
  - Task 增加 parent_task_id、origin（user|agent）、origin_handoff_id。
  - 新服务 backend/app/services/handoff_service.py：open_work / close_work / take_result / answer_text / upstream_of / status_of。
  - orchestrator._run_multi_agent_task 结束处调用 close_work 而不是直接 send_result_message。
- **优先级**：P0
- **数据与迁移影响**：2 张新表 + Task 3 列（nullable）；存量任务 parent_task_id 为空即顶层。
- **测试点**：A→B→C 三级链，C 的结果只在 B 的所有子工作完成后才回 A；A 向正在等它的 B 发消息被拒；同一 work 的结果只被 take 一次；删除 Agent 时其 open work 全部 drop 并通知上游。

#### M8 长结果落盘 + 长消息转文件
- **机制**：state 里只留 2000 字符，全文写 handoff-results/<id>.txt（先写后引用）；超过 20000 字符的消息本身也走文件（handoffs.js:30-91、delivery.js:130-143）。
- **改动落点**：app/core/config.py 增加 handoff_result_dir（默认 data/handoff-results）；handoff_service 用 tempfile + os.replace 原子写；消息附加 attachments 表（若已有则复用）；API 增加 GET /api/v1/handoffs/{id}/result。
- **优先级**：P0
- **数据与迁移影响**：文件目录 + Handoff.result_path；容器部署需挂载卷；清理策略要"答复投递成功后才删"。
- **测试点**：>2000 字符结果落盘且重启后可读；文件缺失时降级为截断文本并标注；清理不删仍被引用的文件。

#### M9 幂等 request_id（admission receipt）
- **机制**：调用方自命名请求，重复发送不重复执行；四种结局 replay/conflict/uncertain/expired；收据先落盘再发送（requests.js:1-14、34-111；tools.js:176-199）。
- **改动落点**：新模型 RequestReceipt(id, key unique, fingerprint, outcome[pending|delivered|uncertain], run_id, receipt_json, created_at)；新服务 backend/app/services/request_service.py；Agent 工具与协作 API 都走它。
- **优先级**：P0
- **数据与迁移影响**：1 张新表；key = caller + context + name 的哈希；保留策略需显式（不建议 TTL 自动过期，DS-Bot 注释 11-13 明确说明）。
- **测试点**：同 key 同内容 → 返回首次 receipt；同 key 异内容 → 409 conflict；重启后未结算 → uncertain；只读模式 → 拒绝。

#### M10 双主体鉴权（User / Agent × Main / Group Admin / Member）
- **机制**：所有写操作带 actorId（Bot 或 undefined=用户），逐项校验；权限类操作只允许用户（roster.js:452-491、memory.js:703-708）。
- **改动落点**：backend/app/core/permissions.py 增加 AGENT_CAPABILITY_MATRIX 与 `principal` 依赖（区分 user token 与 agent 执行上下文）；backend/app/api/rbac_compat.py 兼容层扩展；Agent.is_main、GroupChat.admin_agent_id。
- **优先级**：P0
- **数据与迁移影响**：Agent +1 列；不改既有 4 角色语义（workspace 角色仍管"人对控制台"）。
- **测试点**：矩阵每一格 allowed/denied；agent 调"改权限"接口被拒；非成员 agent 发群消息被拒；admin 不能退出群而不转交。

#### M11 实时状态协议（live + room-progress + revision 短路）
- **机制**：view（随 revision）与 live（不随 revision）分离；room-progress 单独查；SSE/WS 推 5 类事件（channel.js:38-95、225-226；feed.js:1-9、34-88）。
- **改动落点**：backend/app/websocket/events.py 增加 group.round_updated / group.speaker_changed / group.reply_appended / group.paused / handoff.updated / memory.updated / usage.tick；新增 GET /api/v1/workspaces/{id}/live（对应 live()）；websocket/snapshot.py 加入 rounds 与 active speakers。
- **优先级**：P0
- **数据与迁移影响**：无表变更；需要 workspace 级 revision（可在 workspaces 表加 revision 或复用 max(updated_at)）。
- **测试点**：事件顺序；断线重连后快照补齐；100 并发群事件不串房；前端 1.5s 轮询在 revision 未变时零负载。

---

### 9.2 P1（决定"长期可用"的机制）

#### M12 记忆三作用域模型与 Markdown 存储
- **机制**：agent / group / team 三作用域，各自 MEMORY.md + topic 文件，索引链接（memory.js:1-25、41、88-187）。
- **改动落点**：新模型 MemoryScope(id, kind[agent|group|team], owner_id)、MemoryEntry(id, scope_id, topic, text, meta_json, line_no, created_at, updated_at)、MemoryFile(scope_id, topic, content, size)（或直接文件系统 + DB 索引）；服务 backend/app/services/memory_service.py。
- **优先级**：P1
- **数据与迁移影响**：3 张新表；如果沿用 Markdown 文件，需在 DB 存 journal 与快照以保证可查询。
- **测试点**：作用域隔离；topic 上限 40；entry 300 / main 4000 / topic 16000 字符。

#### M13 记忆写入收口 + journal
- **机制**：所有写入（工具/review/面板）走同一函数，串行、先补未完成写、鉴权、重读、限额、双写（文件 + journal before/after）（memory.js:749-843）。
- **改动落点**：memory_service.add/replace/remove；MemoryJournal(id, scope_id, op, file, actor, before, after, at)。
- **优先级**：P1
- **数据与迁移影响**：+1 表；journal 只追加。
- **测试点**：并发写不交错；超限报错含"怎么腾地方"；journal 可回放。

#### M14 memory review 流水线
- **机制**：turn 结束后延迟 2 秒，从游标读新增行，只保留用户发言，一次模型调用产出 add/edit/remove，逐条再校验，游标只前进，满 8 条则同批重读最多 4 轮（memory.js:1450-1735）。
- **改动落点**：memory_service.review_batch + MemoryReviewCursor(scope_id, since_seq)；后台任务用 FastAPI BackgroundTasks 或现有 worker（注意跨进程需锁）。
- **优先级**：P1
- **数据与迁移影响**：+1 表；review 游标与消息 seq 对齐。
- **测试点**：失败不回退游标；只读无用户发言时不调用模型；团队写入受权限复查；删除 Agent 中途停止。

#### M15 记忆注入与快照冻结 + 面板 API
- **机制**：system prompt 一段（order 645），首次渲染写快照并冻结；新 part/checkpoint 后解冻（memory.js:916-1025）；面板 3 个 endpoint + 摘要缓存（memory.js:1226-1420、1737-1742）。
- **改动落点**：orchestrator 组装 system prompt 处插入 memory 段（注意顺序：身份 → 记忆）；Conversation 增加 memory_snapshot_hash；API /api/v1/memory/{view,ask,forget}。
- **优先级**：P1
- **数据与迁移影响**：Conversation +1 列；快照可存 memory_snapshots 表。
- **测试点**：同一 part 内 prompt 字节稳定；checkpoint 后刷新；摘要 hash 未变不重复调用。

#### M16 上下文阈值与"增长门槛"
- **机制**：usable = window - reserve；hard = 95%；check = ratio × usable；且必须增长 check/4 才再次触发（steward.js:20-27；parts.js:750）。
- **改动落点**：app/core/config.py 增加 context_check_ratio（默认 0.8）；新建 backend/app/services/context_governor.py 计算 linesFor()；orchestrator 每次调用前取 token 估算。
- **优先级**：P1
- **数据与迁移影响**：无表变更；模型目录需支持 context_window 字段（custom_models 已有则补）。
- **测试点**：小窗口/大 reserve 的边界；增长不足不触发；估算失败降级。

#### M17 steward 决策
- **机制**：小模型只读最近 40 行、6000 token 预算，输出 {action:switch|compact}；解析取最后一个 JSON；失败降级为 switch（steward.js:29-130；parts.js:576-618）。
- **改动落点**：context_governor.decide()；复用 litellm_service 的调用能力；调用计量 kind='context'。
- **优先级**：P1
- **数据与迁移影响**：无；但 model_calls 需允许 kind 非任务调用。
- **测试点**：给定三类对话样本（未完/已完成/引用旧 JSON）判定正确；无 JSON → switch。

#### M18 checkpoint 与新 part（会话分段）
- **机制**：compact = 原地换成 checkpoint（摘要 + 逐字保留最近消息）；switch = 新 Conversation 分片 + handoff 包（note + 最近消息 + 锚点清单）；旧段归档仍可搜（steward.js:97-165；parts.js:378-572、840-1060）。
- **改动落点**：Conversation 增加 part_index、parent_conversation_id、ended_at、handoff_note、fallback_kind；新表 context_checkpoints(conversation_id, number, summary, kept_json, created_at)；新服务 backend/app/services/part_service.py。
- **优先级**：P1
- **数据与迁移影响**：conversations +5 列；checkpoints +1 表；历史会话 part_index=1。
- **测试点**：note 失败两次后按 hard 线降级；旧段仍可检索；tasks/schedules 迁移到新段。

#### M19 全文检索（read_own_chat 等价）
- **机制**：增量索引 + 三读法（搜索/最近/锚点周边）+ 隐藏当前 turn（chat-index.js:103-259）。
- **改动落点**：SQLite 用 FTS5(trigram)；PG 用 tsvector + pg_trgm 或 zhparser；新表 chat_index_marks(conversation_id, through_seq, sealed)；服务 backend/app/services/chat_index_service.py；工具/API GET /api/v1/conversations/{id}/search。
- **优先级**：P1
- **数据与迁移影响**：+2 表（或 PG 的 materialized 列）；索引可从 messages 重建。
- **测试点**：中文三字以上命中；短词 LIKE 回退；锚点解析；索引缺口不写入。

#### M20 用量账本（kind / owner / 15 分钟槽）
- **机制**：日志回填 + 实时计量双来源；按 (session, provider, model, kind, 15min) 聚合，输出 (hour, owner, model, kind, 5 个数字)（usage.js:1-12、53-106、438-519）。
- **改动落点**：model_calls 增加 kind、owner_type、owner_id、slot_15m（可计算列）；新表 usage_marks(conversation_id, through_seq, sealed)；扩展 backend/app/api/v1/endpoints/cost_stats.py 输出维度。
- **优先级**：P1
- **数据与迁移影响**：model_calls +4 列（可空），存量回填 kind='task'；聚合查询加索引 (workspace_id, slot_15m)。
- **测试点**：同一 attempt 重试不重复计数；fork 继承段 reset；删除 Agent 后用旧名仍可显示。

#### M21 重启恢复（inflight）
- **机制**：记录"正在跑的 turn"与"已投递未取走的消息"，重启后补一次；已结束的用日志补答，不重发请求（resume.js:1-107）。
- **改动落点**：新表 inflight_turns(conversation_id, task_id, agent_id, started_at, trigger_json, resumed_at)；startup lifespan 里跑 recover（main.py:43-67 已有 recover_unfinished_tasks，可扩展）。
- **优先级**：P1
- **数据与迁移影响**：+1 表；配合 Task.execution_token 已有机制。
- **测试点**：kill -9 后重启不重复执行副作用；等待方收到"已中断"通知；群 round 的 waiting slot 复位。

#### M22 群设置 API 与校验点
- **机制**：改名/公告/成员/模式/admin/工作目录/权限预设/relay 上限，逐项鉴权，返回 changes 文案（roster.js:452-559；tools.js:477-536）。
- **改动落点**：backend/app/api/v1/endpoints/groups.py + schemas/group.py；复用 permissions.require_workspace_* 与新的 agent 主体依赖。
- **优先级**：P1
- **数据与迁移影响**：无新表。
- **测试点**：admin 不能改 workdir / permission / relay_limit；移出成员清空 seat；改名冲突 409。

#### M23 回合内用户插话
- **机制**：round 运行中用户再发消息，写进 log 并插到当前 speaker 之前，重置 relay 计数（groups.js:436-453）。
- **改动落点**：message_hub.receive_user_message 检测进行中的 round → round_service.inject(message)；返回的 Task 归属该 round 而非新开。
- **优先级**：P1
- **数据与迁移影响**：无。
- **测试点**：插话后后续 speaker 能读到；不会开第二个 round；计数归零。

#### M24 成员工作期间的碎句合并
- **机制**：30 秒窗口合并，含 @ 立即发出，turn 结束时把剩余并入最终回复（groups.js:879-909；turns.js:580-593）。
- **改动落点**：round_service.step_buffer（按 conversation 的 asyncio 队列）；Worker 输出流回调接入。
- **优先级**：P1
- **数据与迁移影响**：可选 Redis/内存；单进程内存即可。
- **测试点**：连续 5 条短句只产生 1 条群消息；含 @ 立即发；结束时不丢行。

---

### 9.3 P2（体验增强，可后置）

#### M25 交互卡片（ask_user / show_view）
- **机制**：卡片写入 state.questions/views，作答先删后入队，失败回滚（tools.js:609-664；channel.js:377-424；parts.js:104-180）。
- **落点**：新表 pending_cards(conversation_id, kind, payload_json, call_id)；WS 事件 card.created / card.answered。
- **影响**：+1 表；前端需渲染组件。
- **测试点**：重复作答被拒；过期作答 409；用户任意新消息自动关闭卡片。

#### M26 审批接管（隐藏会话）
- **机制**：群成员会话是隐藏的，审批卡无人可见，故插件自己接管并转成群里的可答复项（approvals.js:15-59）。
- **落点**：TaskStatus.WAITING_APPROVAL 已有（enums.py:22），增加 approval_owner_session 与通知渠道。
- **影响**：Task +1 列。
- **测试点**：审批超时；拒绝后继续；会话结束时取消。

#### M27 定时任务
- **机制**：任务绑定到会话，到期以"用户消息"形式进入（schedules.js:1-140）。
- **落点**：新表 schedules；worker 轮询；到点调用 message_hub.receive_user_message（sender=system）。
- **影响**：+1 表。
- **测试点**：时区；群任务进入群 round；会话分段后任务迁移。

#### M28 远程控制 relay
- **机制**：出站 WebSocket + endpoint 白名单（provider-/secret-/diagnostics-/relay- 禁止）（relay.js:1-11；shared/relay-protocol.js:32-46）。
- **落点**：backend/app/websocket/relay.py 已有骨架，可加白名单与协议版本。
- **影响**：无表；relay.json 等价配置入库或环境变量。
- **测试点**：禁用端点被拒；断线重连退避；token 失效关闭码。

#### M29 capabilities / secrets / browser
- **机制**：能力以"库 + 附加到 Bot"两段式（capabilities.js），secret 由用户填写、模型只见环境变量名（secrets.js）。
- **落点**：Agent 已有 tools 概念，可挂 mcp/skill 配置；Secret 与 provider_credential 区分开。
- **影响**：+2~3 表。
- **测试点**：值不外泄；掩码替换；删除 Agent 时清理授权。

---

### 9.4 不建议照搬的地方（重要）

1. **state.json 全量重写**：DS-Bot 因无数据库只能如此，Agent Console 有事务，不要模仿。
2. **轮询代替推送**：DS-Bot 1.5 秒轮询是宿主限制；Agent Console 有 WS 总线，应"WS 增量 + 断线快照"。
3. **进程内 Map 作为真相**：live/roomProgress/works 都在内存，重启即失（靠 inflight 补）。Agent Console 应写库 + 内存只做缓存。
4. **prompt 用字符串拼接**：DS-Bot 直接拼 Markdown 文本段；Agent Console 应模板化并版本化，便于回归测试。
5. **把"隐藏会话"实现成另一套 Session**：Agent Console 用 Conversation + 执行器即可，但要保留"每成员每群独立上下文 + 独立已读位点"这两个语义。
6. **单写者锁**：DS-Bot 的 state.lock 是为了多宿主互斥；Agent Console 用数据库行锁/乐观版本即可。

### 9.5 建议落地顺序

| 阶段 | 内容 | 产出 |
|---|---|---|
| Sprint 1 | M1 + M2 + M3 + M4 + M11 | 群聊能按序发言、@ 能交接、UI 能看到谁在说 |
| Sprint 2 | M5 + M6 + M23 + M24 + M7 + M8 | 长会话不炸、接力不失控、交接不丢结果 |
| Sprint 3 | M9 + M10 + M22 + M21 | 幂等、权限、可恢复 |
| Sprint 4 | M12–M15 | 记忆闭环（写入/review/注入/面板） |
| Sprint 5 | M16–M19 | 上下文治理与全文检索 |
| Sprint 6 | M20 + M25–M29 | 用量与体验增强 |

---

## 10. 附录

### 10.1 限额与常量速查

| 常量 | 值 | 语义 | 证据 |
|---|---|---|---|
| MAX_EXCHANGES | 600 | Bot 间对话记录上限 | constants.js:23 |
| TEXT_KEPT | 2000 | state.json 单文本保留字符 | constants.js:27 |
| GROUP_LINE_READ | 20000 | 群单行可读字符 | constants.js:29 |
| MESSAGE_INLINE_MAX | 20000 | 超过转文件 | constants.js:34 |
| LONG_HEAD | 1000 | 转文件时正文保留的头部 | constants.js:35 |
| ROOM_REPLY_TIMEOUT_MS | 240000 | 成员沉默超时 | constants.js:38 |
| ROOM_STEP_GAP_MS | 30000 | 碎句合并窗口 | constants.js:40 |
| ROOM_WORK_GRACE_MS | 15000 | 工作放行宽限 | constants.js:74 |
| ROOM_MODES | everyone / admin | 回复模式 | constants.js:53 |
| ROOM_MAX_MEMBERS | 12 | 群成员上限 | constants.js:56 |
| OWN_CHAT_READ / SEARCH / BRIEF | 12 / 20 / 10 | 私聊读取条数 | constants.js:80-82 |
| ANCHOR_LINE_MAX | 8000 | 锚点行全文 | constants.js:79 |
| MEMORY entry/main/topic/topics | 300/4000/16000/40 | 记忆限额 | memory.js:41 |
| DEFAULT_WINDOW / DEFAULT_CHECK_RATIO | 500000 / 0.8 | 上下文默认 | steward.js:12-13 |
| HARD_SHARE | 0.95 | 硬线比例 | steward.js:16 |
| STEWARD_TOKENS / STEWARD_LINES | 6000 / 40 | steward 输入预算 | steward.js:17-18、parts.js:244 |
| RECENT_TOKENS / LIST_TOKENS | 16384 / 4096 | handoff 携带预算 | parts.js:226-228 |
| NOTE_ATTEMPTS / NOTE_COOLDOWN_MS | 2 / [60s,300s,900s] | note 重试 | parts.js:233-236 |
| REVIEW_DELAY_MS / REVIEW_TEXT_MAX | 2000 / 16000 | review 时机与预算 | memory.js:60-68 |
| REVIEW_CHANGES_MAX / PASSES_MAX | 8 / 4 | 每次 review 上限 | memory.js:67-68 |
| SLOT_MS | 15 分钟 | 用量槽 | usage.js:28 |

### 10.2 state.json 形状（字段级）

~~~
{
  version: 1, revision: 0, workspaceId?,
  mainBotIds: [id],
  bots: { id: { id, name, role, color?, avatar?, model?, effort?, workDir?, instructions,
                createdAt, createdBy, capabilities:[], segments:[{sessionId, endedAt, tokens?, note?}],
                kickoff?, permission?, hidden?, pinned? } },
  rooms: { id: { id, name, named?, members:[id], admin, mode, notice, createdAt, createdBy,
                 sessions:{botId: sessionId}, segments:{botId:[{sessionId, endedAt, note?}]},
                 log:[{seq, who, botId?, text, kind?, reason?, names?, files?, length?}],
                 seen:{botId: seq}, seq, relays, paused:[{id,name,note?,by?}],
                 permission?, workDir?, relayLimit? } },
  agents, capabilities:{items},
  exchanges:[{id, from, to, text, role, time, replyTo?, length?, files?, sessionId?}],
  exchangeTurns:{sessionId:[turn]},
  works:{ workId: {from,to,room?,parent?,open:[],results:[{id,name,text,length?,file?}],at,held?} },
  requests:{ key: {fingerprint, outcome, at, run, receipt?} },
  questions:{sessionId: card}, views:{sessionId: card}, switching:{}, prefs:{}
}
~~~

（依据 store.js:21-22 与各模块写入点：turns.js:163-176、groups.js:187-192、handoffs.js:99-104、requests.js:91-92。）

### 10.3 工具清单（TEAM_TOOLS，constants.js:64-71）

~~~
list_bots, message_bot, stop_bot, create_bot, update_bot, list_bot_models,
create_group, update_group, delete_group, post_to_group, ask_user, show_view,
request_secret, list_secrets, group_relay, read_own_chat, read_group_chat,
remember, forget, recall, read_browser, list_capabilities, save_capability,
delete_capability, attach_capability, detach_capability
~~~

其中 group_relay / read_own_chat / read_group_chat 在 groups.js 注册；remember / forget / recall 在 memory.js；其余在 tools.js。

### 10.4 宿主钩子清单（决定"在哪里插入逻辑"）

| 钩子 | 用途 | 证据 |
|---|---|---|
| session/event | 所有 turn 状态、消息、tool 调用 | turns.js:366 起 |
| agent/pre-step（prepend） | 上下文检查、part 切换、handoff 转发 | parts.js:1068-1094 |
| agent/request-error | 溢出与坏请求救援 | parts.js:1166-1193 |
| agent/status | idle 时检查上下文 + 触发 memory review | parts.js:1240-1245；memory.js:1710-1729 |
| approval/request | 接管隐藏会话审批 | approvals.js:15-48 |
| llm/stream | 用量实时计量、裸 handoff 应答 | usage.js:579-599；parts.js:1250-1263 |
| systemPrompt.section | 身份段 640 / 记忆段 645 | prompt.js:67-72；memory.js:1020-1025 |

对 Agent Console 的对应物：orchestrator 的 `_run_agent_with_tools` 前后、`call_agent_model`、`save_task_step`、`send_result_message`，以及 WS 广播点（backend/app/core/orchestrator.py:906-994、883-905、994-1040、1118-1150）。

### 10.5 证据索引（按主题）

| 主题 | 主要证据 |
|---|---|
| 群调度 | groups.js:455-572、771-788、382-394、198-264 |
| PASS | groups.js:81、514-541、553-563 |
| relay 上限 | groups.js:39-40、469-487、564-571、955-968 |
| 隐藏会话/已读 | groups.js:198-228、52-56、702-711 |
| 消息上限 | groups.js:31-34、126、179-185；constants.js:27-38 |
| 交接 | handoffs.js:99-186、delivery.js:54-106、tools.js:141-267 |
| 长结果 | handoffs.js:30-91；delivery.js:130-143 |
| 幂等 | requests.js:34-111；tools.js:176-199 |
| 记忆 | memory.js:1-25、41、691-843、916-1025、1097-1223、1226-1420、1450-1735 |
| 上下文 | steward.js:20-165；parts.js:526-650、1068-1216、840-1060 |
| 检索 | chat-index.js:103-259 |
| 权限 | roster.js:248-347、452-559、582-647；permissions.js:1-79；memory.js:703-708 |
| 用量 | usage.js:53-106、141-193、380-519、579-599 |
| 协议 | channel.js:38-98、139-164、571-581；feed.js:1-126；client.js:1314-1348、19435-19505 |
| 重启 | resume.js:1-107；parts.js:817-836 |
| 定时 | schedules.js:1-140 |

---

*报告完。所有行号基于 E:/Agents/.tmp/dsbot/package 当前解包版本；引用前建议以 grep 复核一次。*

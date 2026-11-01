import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

// VM 上下文中的对象/数组与原 realm 原型不同，deepStrictEqual 需先转成普通值。
const plain = (value) => JSON.parse(JSON.stringify(value))
const deep = (actual, expected) => assert.deepEqual(plain(actual), plain(expected))

const makeEntries = () => [
  {
    key: "agent-1",
    name: "项目总设计师",
    kind: "agent",
    avatar: null,
    subtitle: "manager_model",
    role: "project_architect",
    roleLabel: "项目总设计师",
    aliases: ["架构师", "总设计师"],
    status: "idle",
  },
  {
    key: "agent-2",
    name: "前端设计师",
    kind: "agent",
    avatar: null,
    subtitle: "code_model",
    role: "frontend_designer",
    roleLabel: "前端设计师",
    aliases: ["前端", "UI"],
    status: "idle",
  },
  {
    key: "agent-3",
    name: "测试专员",
    kind: "agent",
    avatar: null,
    subtitle: "review_model",
    role: "qa_engineer",
    roleLabel: "测试专员",
    aliases: ["测试", "QA"],
    status: "idle",
  },
  {
    key: "node-1",
    name: "Cursor",
    kind: "integration",
    avatar: "C",
    subtitle: "cursor",
    role: "integration",
    roleLabel: "外部节点",
    aliases: ["cursor"],
    status: "online",
  },
]

const message = (overrides) => ({
  id: 1,
  conversation_id: 1,
  sender_type: "agent",
  sender_id: 2,
  content: "内容",
  message_type: "normal",
  created_at: "2026-11-01T10:00:00+08:00",
  ...overrides,
})

describe("relay-utils", () => {
  const mod = loadTsModule("./src/lib/relay-utils.ts")
  const entries = makeEntries()

  describe("extractMentionEntries", () => {
    it("按出现顺序提取多个 @ 目标", () => {
      const found = mod.extractMentionEntries(
        "@前端设计师 先做界面，@测试专员 验收",
        entries,
      )
      deep(found.map((entry) => entry.name), ["前端设计师", "测试专员"])
    })

    it("支持全角 ＠ 与中文无空格语境", () => {
      const found = mod.extractMentionEntries("请＠前端设计师处理并@测试验收", entries)
      deep(found.map((entry) => entry.name), ["前端设计师", "测试专员"])
    })

    it("重复提及只保留首次出现", () => {
      const found = mod.extractMentionEntries("@测试专员 先看，再让 @测试专员 复核", entries)
      assert.equal(found.length, 1)
      assert.equal(found[0].name, "测试专员")
    })

    it("按别名解析且最长候选优先", () => {
      const found = mod.extractMentionEntries("@前端 和 @总设计师 一起看", entries)
      deep(found.map((entry) => entry.name), ["前端设计师", "项目总设计师"])
    })

    it("排除邮箱中的 @", () => {
      const found = mod.extractMentionEntries("联系 support@example.com 后找 @测试专员", entries)
      deep(found.map((entry) => entry.name), ["测试专员"])
    })

    it("英文候选词遵守单词边界", () => {
      const custom = [
        { key: "agent-x", name: "code", kind: "agent", avatar: null, subtitle: "m", role: "r", roleLabel: "r", aliases: [], status: "idle" },
      ]
      deep(mod.extractMentionEntries("@coder 不是 @code", custom).map((e) => e.name), ["code"])
    })
  })

  describe("buildRelayChainPreview", () => {
    it("少于两位内部 Agent 时不形成接力链", () => {
      deep(mod.buildRelayChainPreview("@测试专员 处理", entries), [])
      deep(mod.buildRelayChainPreview("@Cursor 先处理", entries), [])
    })

    it("多位 Agent 时返回有序接力链并排除外部节点", () => {
      const chain = mod.buildRelayChainPreview("@Cursor @测试专员 @前端设计师", entries)
      deep(chain.map((entry) => entry.name), ["测试专员", "前端设计师"])
    })

    it("接力链长度上限为 6", () => {
      const many = Array.from({ length: 9 }, (_, index) => ({
        key: `agent-${index}`,
        name: `成员${index}`,
        kind: "agent",
        avatar: null,
        subtitle: "m",
        role: "r",
        roleLabel: "r",
        aliases: [],
        status: "idle",
      }))
      const text = many.map((entry) => `@${entry.name}`).join(" ")
      assert.equal(mod.buildRelayChainPreview(text, many).length, 6)
    })
  })

  describe("formatDayDivider", () => {
    const now = new Date("2026-11-01T12:00:00+08:00")
    it("今天与昨天", () => {
      assert.equal(mod.formatDayDivider("2026-11-01T09:00:00+08:00", now), "今天")
      assert.equal(mod.formatDayDivider("2026-10-31T23:00:00+08:00", now), "昨天")
    })
    it("更早日期显示月日，跨年补年份", () => {
      assert.equal(mod.formatDayDivider("2026-06-24T10:00:00+08:00", now), "6月24日")
      assert.equal(mod.formatDayDivider("2025-12-31T10:00:00+08:00", now), "2025年12月31日")
    })
  })

  describe("buildMessageTimeline", () => {
    const now = new Date("2026-11-01T12:00:00+08:00")

    it("连续同发送者消息合并分组，仅末条展示时间", () => {
      const messages = [
        message({ id: 1, sender_id: 2, created_at: "2026-11-01T10:00:00+08:00" }),
        message({ id: 2, sender_id: 2, created_at: "2026-11-01T10:01:00+08:00" }),
        message({ id: 3, sender_id: 2, created_at: "2026-11-01T10:02:00+08:00" }),
      ]
      const timeline = mod.buildMessageTimeline(messages, { now })
      deep(timeline.map((entry) => entry.groupStart), [true, false, false])
      deep(timeline.map((entry) => entry.groupEnd), [false, false, true])
      deep(timeline.map((entry) => entry.showTime), [false, false, true])
    })

    it("不同发送者或超时消息另起分组", () => {
      const messages = [
        message({ id: 1, sender_id: 2, created_at: "2026-11-01T10:00:00+08:00" }),
        message({ id: 2, sender_id: 3, created_at: "2026-11-01T10:00:30+08:00" }),
        message({ id: 3, sender_id: 3, created_at: "2026-11-01T10:40:00+08:00" }),
      ]
      const timeline = mod.buildMessageTimeline(messages, { now })
      deep(timeline.map((entry) => entry.groupStart), [true, true, true])
      assert.ok(timeline[2].dayLabel)
    })

    it("跨天插入时间分隔且首条带分隔", () => {
      const messages = [
        message({ id: 1, created_at: "2026-10-31T23:50:00+08:00" }),
        message({ id: 2, created_at: "2026-11-01T00:10:00+08:00" }),
      ]
      const timeline = mod.buildMessageTimeline(messages, { now })
      assert.equal(timeline[0].dayLabel, "昨天")
      assert.equal(timeline[1].dayLabel, "今天")
    })

    it("系统与错误消息独立成组", () => {
      const messages = [
        message({ id: 1, sender_type: "system", sender_id: null, created_at: "2026-11-01T10:00:00+08:00" }),
        message({ id: 2, sender_type: "system", sender_id: null, created_at: "2026-11-01T10:01:00+08:00" }),
      ]
      const timeline = mod.buildMessageTimeline(messages, { now })
      deep(timeline.map((entry) => entry.groupStart), [true, true])
      deep(timeline.map((entry) => entry.showTime), [true, true])
    })
  })

  describe("assignRelayHops", () => {
    it("按任务时间窗把链上成员回复匹配到棒次", () => {
      const task = {
        id: 10,
        created_at: "2026-11-01T10:00:00+08:00",
        updated_at: "2026-11-01T10:10:00+08:00",
        relay_agent_ids: [2, 3, 4],
      }
      const messages = [
        message({ id: 1, sender_id: null, sender_type: "user", created_at: "2026-11-01T10:00:00+08:00" }),
        message({ id: 2, sender_id: 2, created_at: "2026-11-01T10:01:00+08:00" }),
        message({ id: 3, sender_id: 4, created_at: "2026-11-01T10:05:00+08:00" }),
      ]
      const hops = mod.assignRelayHops(messages, [task])
      deep(hops.get(2), { index: 1, total: 3 })
      deep(hops.get(3), { index: 3, total: 3 })
      assert.equal(hops.get(1), undefined)
    })

    it("普通任务不参与棒次匹配", () => {
      const task = {
        id: 11,
        created_at: "2026-11-01T10:00:00+08:00",
        updated_at: "2026-11-01T10:10:00+08:00",
      }
      const messages = [message({ id: 2, sender_id: 2, created_at: "2026-11-01T10:01:00+08:00" })]
      assert.equal(mod.assignRelayHops(messages, [task]).size, 0)
    })
  })

  describe("接力进度状态推导", () => {
    const agents = [
      { id: 2, name: "前端设计师", role: "frontend_designer", avatar: null, description: "", model_name: "code_model", system_prompt: "", status: "idle", last_active_at: null, created_at: "", workspace_id: 1 },
      { id: 3, name: "测试专员", role: "qa_engineer", avatar: null, description: "", model_name: "review_model", system_prompt: "", status: "idle", last_active_at: null, created_at: "", workspace_id: 1 },
    ]

    it("applyRelayProgress 合并每棒状态", () => {
      const event = (hopIndex, status, agentId = 2) => ({
        task_id: 7,
        conversation_id: 1,
        hop_index: hopIndex,
        total_hops: 2,
        agent_id: agentId,
        agent_name: "x",
        status,
      })
      let state = mod.applyRelayProgress({}, event(1, "started"))
      state = mod.applyRelayProgress(state, event(1, "completed"))
      state = mod.applyRelayProgress(state, event(2, "passed", 3))
      assert.equal(state[7].totalHops, 2)
      deep(state[7].hops, { 1: "completed", 2: "passed" })
    })

    it("deriveRelayHops 映射待执行/进行中/已完成/已跳过/失败", () => {
      const hops = mod.deriveRelayHops([2, 3], agents, {
        totalHops: 2,
        hops: { 1: "completed", 2: "started" },
      })
      deep(hops.map((hop) => hop.state), ["done", "active"])
      deep(hops.map((hop) => hop.name), ["前端设计师", "测试专员"])

      const passed = mod.deriveRelayHops([2, 3], agents, {
        totalHops: 2,
        hops: { 1: "passed", 2: "failed" },
      })
      deep(passed.map((hop) => hop.state), ["passed", "failed"])

      const pending = mod.deriveRelayHops([2, 3], agents, undefined, "running")
      deep(pending.map((hop) => hop.state), ["pending", "pending"])
    })
  })
})

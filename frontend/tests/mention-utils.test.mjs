import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("mention-utils", () => {
  const mod = loadTsModule("./src/lib/mention-utils.ts")

  describe("findMention", () => {
    it("returns null for empty string or text without @", () => {
      assert.equal(mod.findMention("", 0), null)
      assert.equal(mod.findMention("hello world", 5), null)
    })

    it("detects half-width @ at start of input", () => {
      const match = mod.findMention("@", 1)
      assert.notEqual(match, null)
      assert.equal(match.start, 0)
      assert.equal(match.query, "")
    })

    it("detects full-width ＠ at start of input", () => {
      const match = mod.findMention("＠", 1)
      assert.notEqual(match, null)
      assert.equal(match.start, 0)
      assert.equal(match.query, "")
    })

    it("detects mention inside Chinese sentence without spaces before @", () => {
      const text = "请问@测试专员"
      const match = mod.findMention(text, text.length)
      assert.notEqual(match, null)
      assert.equal(match.start, 2)
      assert.equal(match.query, "测试专员")
    })

    it("detects fullwidth ＠ in Chinese sentence", () => {
      const text = "当前任务＠Agent"
      const match = mod.findMention(text, text.length)
      assert.notEqual(match, null)
      assert.equal(match.start, 4)
      assert.equal(match.query, "agent")
    })

    it("returns null when caret is followed by whitespace after @", () => {
      const text = "请问@测试专员 帮我看下"
      assert.equal(mod.findMention(text, text.length), null)
    })

    it("returns null when @ is preceded by ASCII word character (email address)", () => {
      const text = "contact@example.com"
      assert.equal(mod.findMention(text, 8), null)
      assert.equal(mod.findMention("user@", 5), null)
    })

    it("returns last mention when multiple mentions exist in text", () => {
      const text = "@架构师 请通知 @前端"
      const match = mod.findMention(text, text.length)
      assert.notEqual(match, null)
      assert.equal(match.start, 9)
      assert.equal(match.query, "前端")
    })
  })

  describe("buildMentionEntries", () => {
    const mockAgents = [
      {
        id: 2,
        name: "测试专员",
        role: "qa_engineer",
        model_name: "review_model",
        avatar: "🧪",
        description: "质量验证与审查",
        status: "idle",
      },
      {
        id: 1,
        name: "项目总设计师",
        role: "project_architect",
        model_name: "manager_model",
        avatar: "🏗️",
        description: "总体方案设计",
        status: "running",
      },
    ]

    const mockNodes = [
      {
        id: 10,
        name: "Cursor",
        provider: "cursor",
        status: "online",
      },
    ]

    it("sorts agents according to role order and includes integration nodes", () => {
      const entries = mod.buildMentionEntries(mockAgents, mockNodes)
      assert.equal(entries.length, 3)
      assert.equal(entries[0].name, "项目总设计师")
      assert.equal(entries[0].roleLabel, "项目总设计师")
      assert.equal(entries[0].subtitle, "manager_model")
      assert.equal(entries[1].name, "测试专员")
      assert.equal(entries[1].subtitle, "review_model")
      assert.equal(entries[2].name, "Cursor")
      assert.equal(entries[2].kind, "integration")
    })
  })

  describe("filterMentionEntries", () => {
    const entries = [
      {
        key: "agent-1",
        name: "项目总设计师",
        role: "project_architect",
        roleLabel: "项目总设计师",
        aliases: ["架构师", "总设计师", "方案设计"],
        subtitle: "manager_model",
        description: "总体方案拆解",
      },
      {
        key: "agent-2",
        name: "测试专员",
        role: "qa_engineer",
        roleLabel: "测试专员",
        aliases: ["测试", "QA", "质量审核"],
        subtitle: "review_model",
        description: "质量验证与缺陷复现",
      },
      {
        key: "node-1",
        name: "Cursor",
        role: "integration",
        roleLabel: "外部节点",
        subtitle: "cursor",
        description: "外部集成节点",
      },
    ]

    it("returns all entries when query is empty", () => {
      assert.equal(mod.filterMentionEntries(entries, "").length, 3)
      assert.equal(mod.filterMentionEntries(entries, "   ").length, 3)
    })

    it("matches by agent name", () => {
      const res = mod.filterMentionEntries(entries, "测试")
      assert.equal(res.length, 1)
      assert.equal(res[0].name, "测试专员")
    })

    it("matches by role identifier", () => {
      const res = mod.filterMentionEntries(entries, "qa")
      assert.equal(res.length, 1)
      assert.equal(res[0].name, "测试专员")
    })

    it("matches by role alias", () => {
      const res1 = mod.filterMentionEntries(entries, "方案")
      assert.equal(res1.length, 1)
      assert.equal(res1[0].name, "项目总设计师")

      const res2 = mod.filterMentionEntries(entries, "质量")
      assert.equal(res2.length, 1)
      assert.equal(res2[0].name, "测试专员")
    })

    it("matches by model subtitle", () => {
      const res = mod.filterMentionEntries(entries, "manager")
      assert.equal(res.length, 1)
      assert.equal(res[0].name, "项目总设计师")
    })

    it("matches by description keyword", () => {
      const res = mod.filterMentionEntries(entries, "缺陷")
      assert.equal(res.length, 1)
      assert.equal(res[0].name, "测试专员")
    })
  })

  describe("insertMention", () => {
    it("inserts @name and trailing space at trigger position", () => {
      const text = "请问@测"
      const mention = { start: 2, query: "测" }
      const { nextValue, nextCaret } = mod.insertMention(text, text.length, mention, "测试专员")
      assert.equal(nextValue, "请问@测试专员 ")
      assert.equal(nextCaret, "请问@测试专员 ".length)
    })

    it("replaces existing mention token and preserves following text", () => {
      const text = "通知@架构师继续执行"
      // caret is right after @架构师 (pos 6)
      const mention = { start: 2, query: "架构师" }
      const { nextValue } = mod.insertMention(text, 6, mention, "项目总设计师")
      assert.equal(nextValue, "通知@项目总设计师 继续执行")
    })
  })

  describe("linkMentions", () => {
    const agents = [
      { id: 1, name: "项目总设计师" },
      { id: 2, name: "测试专员" },
      { id: 3, name: "Cursor" },
    ]

    it("converts a known agent mention into a mention markdown link", () => {
      assert.equal(
        mod.linkMentions("通知@测试专员 处理", agents),
        "通知[测试专员](mention://2) 处理",
      )
    })

    it("matches the longest agent name instead of a shorter prefix", () => {
      const ambiguous = [
        { id: 7, name: "测试" },
        { id: 2, name: "测试专员" },
      ]
      assert.equal(
        mod.linkMentions("@测试专员 请检查", ambiguous),
        "[测试专员](mention://2) 请检查",
      )
      assert.equal(mod.linkMentions("@测试 先看", ambiguous), "[测试](mention://7) 先看")
    })

    it("keeps fenced code blocks and inline code untouched", () => {
      const fenced = "示例：\n\n```bash\n@测试专员\n```\n\n结束"
      assert.equal(mod.linkMentions(fenced, agents), fenced)
      assert.equal(mod.linkMentions("`@测试专员` 是代码", agents), "`@测试专员` 是代码")
      assert.equal(
        mod.linkMentions("看 `@测试专员` 和 @测试专员", agents),
        "看 `@测试专员` 和 [测试专员](mention://2)",
      )
    })

    it("skips mentions inside markdown links", () => {
      const text = "[@测试专员](https://example.com/@测试专员) 不是提及"
      assert.equal(mod.linkMentions(text, agents), text)
    })

    it("skips email addresses and path prefixes", () => {
      assert.equal(
        mod.linkMentions("联系 contact@Cursor 获取", agents),
        "联系 contact@Cursor 获取",
      )
      assert.equal(mod.linkMentions("路径 src/@Cursor 无效", agents), "路径 src/@Cursor 无效")
    })

    it("skips a mention whose name is followed by identifier characters", () => {
      assert.equal(mod.linkMentions("@Cursors 不是提及", agents), "@Cursors 不是提及")
      assert.equal(
        mod.linkMentions("@Cursor 在运行", agents),
        "[Cursor](mention://3) 在运行",
      )
    })

    it("does not link the sender itself when selfId matches", () => {
      assert.equal(mod.linkMentions("@测试专员 已收到", agents, 2), "@测试专员 已收到")
      assert.equal(
        mod.linkMentions("@测试专员 请通知 @项目总设计师", agents, 2),
        "@测试专员 请通知 [项目总设计师](mention://1)",
      )
    })

    it("links Chinese agent names inside Chinese sentences", () => {
      assert.equal(
        mod.linkMentions("请 @项目总设计师 和 @测试专员 一起看", agents),
        "请 [项目总设计师](mention://1) 和 [测试专员](mention://2) 一起看",
      )
    })

    it("keeps @所有人 as plain text", () => {
      assert.equal(mod.linkMentions("@所有人 请注意", agents), "@所有人 请注意")
    })

    it("leaves text unchanged when nothing matches or the agent list is empty", () => {
      assert.equal(mod.linkMentions("@未知角色 你好", agents), "@未知角色 你好")
      assert.equal(mod.linkMentions("@测试专员 你好", []), "@测试专员 你好")
      assert.equal(mod.linkMentions("", agents), "")
    })

    it("converts every occurrence in a paragraph and keeps markdown structure", () => {
      assert.equal(
        mod.linkMentions("**@测试专员** 与 @Cursor 同时在线", agents),
        "**[测试专员](mention://2)** 与 [Cursor](mention://3) 同时在线",
      )
    })

    it("supports the full-width @ marker", () => {
      assert.equal(
        mod.linkMentions("请＠测试专员 跟进", agents),
        "请[测试专员](mention://2) 跟进",
      )
    })
  })
})

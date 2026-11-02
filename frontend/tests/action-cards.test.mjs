import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("action-cards", () => {
  const mod = loadTsModule("./src/lib/action-cards.ts")

  describe("actionIndexFromKey", () => {
    it("maps option keys to option indexes", () => {
      assert.equal(mod.actionIndexFromKey("A"), 0)
      assert.equal(mod.actionIndexFromKey("b"), 1)
      assert.equal(mod.actionIndexFromKey(" C "), 2)
    })

    it("rejects keys outside the option range", () => {
      assert.equal(mod.actionIndexFromKey("Z"), null)
      assert.equal(mod.actionIndexFromKey(""), null)
      assert.equal(mod.actionIndexFromKey("Enter"), null)
    })
  })

  describe("isEditableTarget", () => {
    it("treats input, textarea and select as editable", () => {
      assert.equal(mod.isEditableTarget({ tagName: "INPUT" }), true)
      assert.equal(mod.isEditableTarget({ tagName: "textarea" }), true)
      assert.equal(mod.isEditableTarget({ tagName: "SELECT" }), true)
    })

    it("treats contenteditable and textbox roles as editable", () => {
      assert.equal(mod.isEditableTarget({ tagName: "DIV", isContentEditable: true }), true)
      assert.equal(
        mod.isEditableTarget({ tagName: "DIV", closest: () => ({}) }),
        true,
      )
    })

    it("returns false for plain elements and non-object targets", () => {
      assert.equal(mod.isEditableTarget({ tagName: "DIV", closest: () => null }), false)
      assert.equal(mod.isEditableTarget(null), false)
      assert.equal(mod.isEditableTarget("A"), false)
    })
  })

  describe("createActionCardArbiter", () => {
    it("lets only the latest registered card respond", () => {
      const arbiter = mod.createActionCardArbiter()
      arbiter.register("card-a")
      assert.equal(arbiter.activeId(), "card-a")
      arbiter.register("card-b")
      assert.equal(arbiter.activeId(), "card-b")
      assert.equal(arbiter.isActive("card-a"), false)
      assert.equal(arbiter.isActive("card-b"), true)
    })

    it("falls back to the previous card after the latest unmounts", () => {
      const arbiter = mod.createActionCardArbiter()
      arbiter.register("card-a")
      arbiter.register("card-b")
      arbiter.unregister("card-b")
      assert.equal(arbiter.activeId(), "card-a")
      arbiter.unregister("card-a")
      assert.equal(arbiter.activeId(), null)
      assert.equal(arbiter.isActive("card-a"), false)
    })

    it("re-registering an id makes it the latest again", () => {
      const arbiter = mod.createActionCardArbiter()
      arbiter.register("card-a")
      arbiter.register("card-b")
      arbiter.register("card-a")
      assert.equal(arbiter.activeId(), "card-a")
    })
  })

  describe("buildApprovalOptions", () => {
    it("returns A/B/C approval options", () => {
      const options = mod.buildApprovalOptions()
      assert.equal(options.length, 3)
      assert.equal(options[0].key, "A")
      assert.equal(options[1].key, "B")
      assert.equal(options[2].key, "C")
      assert.equal(options[0].kind, "action")
      assert.equal(options[1].kind, "action")
      assert.equal(options[2].kind, "note")
    })
  })

  describe("collectApprovalPlacement", () => {
    const waiting = (id, messageId) => ({
      id,
      workspace_id: 1,
      conversation_id: 1,
      title: `Task ${id}`,
      description: "",
      assigned_agent_id: null,
      status: "waiting_approval",
      priority: "normal",
      input_message_id: messageId,
      result: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })
    const message = (id) => ({
      id,
      conversation_id: 1,
      sender_type: "user",
      sender_id: null,
      content: "hi",
      message_type: "normal",
      created_at: "2026-01-01T00:00:00Z",
    })

    it("ignores tasks that are not waiting for approval", () => {
      const placement = mod.collectApprovalPlacement(
        [{ ...waiting(1, 10), status: "running" }],
        [message(10)],
      )
      assert.equal(placement.inlineByMessageId.size, 0)
      assert.equal(placement.dock.length, 0)
    })

    it("renders a task inline when its input message is visible", () => {
      const placement = mod.collectApprovalPlacement([waiting(1, 10)], [message(10)])
      assert.equal(placement.inlineByMessageId.get(10).id, 1)
      assert.equal(placement.dock.length, 0)
    })

    it("falls back to the dock when the message is not loaded", () => {
      const placement = mod.collectApprovalPlacement([waiting(1, 10)], [])
      assert.equal(placement.inlineByMessageId.size, 0)
      assert.equal(placement.dock.length, 1)
      assert.equal(placement.dock[0].id, 1)
    })

    it("keeps only one card per message and docks the rest", () => {
      const placement = mod.collectApprovalPlacement(
        [waiting(1, 10), waiting(2, 10), waiting(3, null)],
        [message(10)],
      )
      assert.equal(placement.inlineByMessageId.size, 1)
      assert.equal(placement.inlineByMessageId.get(10).id, 1)
      assert.equal(placement.dock.length, 2)
      assert.equal(placement.dock[0].id, 2)
      assert.equal(placement.dock[1].id, 3)
    })

    it("removes dismissed tasks from both placements", () => {
      const placement = mod.collectApprovalPlacement(
        [waiting(1, 10), waiting(2, null)],
        [message(10)],
        new Set([1, 2]),
      )
      assert.equal(placement.inlineByMessageId.size, 0)
      assert.equal(placement.dock.length, 0)
    })
  })
})

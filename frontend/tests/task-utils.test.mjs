import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("task-utils", () => {
  const mod = loadTsModule("./src/lib/task-utils.ts")

  describe("taskTimestamp", () => {
    it("returns epoch ms for a valid ISO date", () => {
      assert.equal(mod.taskTimestamp({ updated_at: "2026-01-01T00:00:00.000Z" }), new Date("2026-01-01T00:00:00.000Z").getTime())
    })
    it("returns 0 for an invalid date string", () => {
      assert.equal(mod.taskTimestamp({ updated_at: "not-a-date" }), 0)
    })
  })

  describe("taskStatusRank", () => {
    it("ranks completed/failed/cancelled as 2 (terminal)", () => {
      assert.equal(mod.taskStatusRank("completed"), 2)
      assert.equal(mod.taskStatusRank("failed"), 2)
      assert.equal(mod.taskStatusRank("cancelled"), 2)
    })
    it("ranks running as 1", () => {
      assert.equal(mod.taskStatusRank("running"), 1)
    })
    it("ranks pending as 0", () => {
      assert.equal(mod.taskStatusRank("pending"), 0)
    })
  })

  describe("shouldApplyTaskStatus", () => {
    it("replaces when next has a newer timestamp", () => {
      const current = { status: "running", updated_at: "2026-01-01T00:00:00Z" }
      const next = { status: "pending", updated_at: "2026-01-02T00:00:00Z" }
      assert.equal(mod.shouldApplyTaskStatus(current, next), true)
    })
    it("keeps when current has a newer timestamp", () => {
      const current = { status: "running", updated_at: "2026-01-02T00:00:00Z" }
      const next = { status: "pending", updated_at: "2026-01-01T00:00:00Z" }
      assert.equal(mod.shouldApplyTaskStatus(current, next), false)
    })
    it("replaces when same timestamp and next has higher rank", () => {
      const current = { status: "pending", updated_at: "2026-01-01T00:00:00Z" }
      const next = { status: "running", updated_at: "2026-01-01T00:00:00Z" }
      assert.equal(mod.shouldApplyTaskStatus(current, next), true)
    })
    it("keeps when same timestamp and current has higher or equal rank", () => {
      const current = { status: "completed", updated_at: "2026-01-01T00:00:00Z" }
      const next = { status: "running", updated_at: "2026-01-01T00:00:00Z" }
      assert.equal(mod.shouldApplyTaskStatus(current, next), false)
    })
  })
})

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("task-format", () => {
  const mod = loadTsModule("./src/lib/task-format.ts")

  describe("formatDuration", () => {
    it('returns "进行中" for null', () => {
      assert.equal(mod.formatDuration(null), "进行中")
    })
    it("formats milliseconds under 1 second", () => {
      assert.equal(mod.formatDuration(500), "500 ms")
    })
    it("formats seconds with 2 decimals for values under 10s", () => {
      assert.equal(mod.formatDuration(3500), "3.50 s")
    })
    it("formats seconds with 1 decimal for values 10-60s", () => {
      assert.equal(mod.formatDuration(15500), "15.5 s")
    })
    it("formats minutes and seconds", () => {
      const result = mod.formatDuration(125000)
      assert.ok(result.includes("分"))
      assert.ok(result.includes("秒"))
    })
  })

  describe("formatTokens", () => {
    it("formats numbers with zh-CN grouping", () => {
      const result = mod.formatTokens(12345)
      assert.equal(result, "12,345")
    })
    it("formats zero", () => {
      assert.equal(mod.formatTokens(0), "0")
    })
  })

  describe("formatCost", () => {
    it("returns $0.000000 for zero", () => {
      assert.equal(mod.formatCost("0"), "$0.000000")
    })
    it("returns $0.000000 for invalid number", () => {
      assert.equal(mod.formatCost("not-a-number"), "$0.000000")
    })
    it("formats 6 decimal places", () => {
      assert.equal(mod.formatCost("0.0015"), "$0.001500")
    })
  })

  describe("stepLabel", () => {
    it('returns "Manager 任务拆解" for manager_plan', () => {
      assert.equal(mod.stepLabel("manager_plan"), "Manager 任务拆解")
    })
    it('returns "测试专员审核" for review_results', () => {
      assert.equal(mod.stepLabel("review_results"), "测试专员审核")
    })
    it('returns "Manager 最终汇总" for final_summary', () => {
      assert.equal(mod.stepLabel("final_summary"), "Manager 最终汇总")
    })
    it("labels worker_execute steps with the worker number", () => {
      assert.equal(mod.stepLabel("worker_execute_1"), "Worker 执行 1")
      assert.equal(mod.stepLabel("worker_execute_2"), "Worker 执行 2")
    })
    it("returns the raw step name for unknown steps", () => {
      assert.equal(mod.stepLabel("unknown_step"), "unknown_step")
    })
  })
})

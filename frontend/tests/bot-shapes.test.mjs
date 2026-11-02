import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { loadTsModule } from "./load-ts-module.mjs"

const SHAPE_IDS = ["whale", "star", "moon", "gumdrop", "squircle"]

describe("bot-shapes", () => {
  const mod = loadTsModule("./src/lib/bot-shapes.ts")

  it("只导出本批落地的五个形状", () => {
    assert.deepEqual([...mod.BOT_SHAPE_IDS], SHAPE_IDS)
    assert.deepEqual(Object.keys(mod.BOT_SHAPES).sort(), [...SHAPE_IDS].sort())
  })

  it("每个形状的 body/shade/light 都是非空 path 且带 label", () => {
    for (const id of SHAPE_IDS) {
      const shape = mod.BOT_SHAPES[id]
      assert.equal(typeof shape.label, "string")
      assert.ok(shape.label.length > 0)
      for (const field of ["body", "shade", "light"]) {
        assert.equal(typeof shape[field], "string", `${id}.${field} 应为字符串`)
        assert.ok(shape[field].length > 50, `${id}.${field} 不能为空 path`)
        assert.ok(shape[field].trim().startsWith("M"), `${id}.${field} 应为 SVG path`)
      }
    }
  })

  it("eyes 是合法五元组（有限数值且宽高为正）", () => {
    for (const id of SHAPE_IDS) {
      const { eyes } = mod.BOT_SHAPES[id]
      assert.ok(Array.isArray(eyes), `${id}.eyes 应为数组`)
      assert.ok(eyes.length >= 1)
      for (const eye of eyes) {
        assert.equal(eye.length, 5, `${id}.eyes 元素应为五元组`)
        for (const value of eye) {
          assert.equal(typeof value, "number")
          assert.ok(Number.isFinite(value), "eyes 数值必须有限")
        }
        assert.ok(eye[2] > 0, "眼睛宽度必须为正")
        assert.ok(eye[3] > 0, "眼睛高度必须为正")
      }
    }
  })

  it("paints 是 [path, fill, opacity] 三元组且保留白高光", () => {
    for (const id of SHAPE_IDS) {
      const { paints } = mod.BOT_SHAPES[id]
      assert.ok(Array.isArray(paints))
      for (const paint of paints) {
        assert.equal(paint.length, 3)
        assert.equal(typeof paint[0], "string")
        assert.ok(paint[0].trim().startsWith("M"))
        assert.ok(typeof paint[1] === "string" && paint[1].length > 0)
        assert.equal(typeof paint[2], "number")
        assert.ok(paint[2] >= 0 && paint[2] <= 1)
      }
    }
    const whalePaint = mod.BOT_SHAPES.whale.paints
    assert.equal(whalePaint.length, 1)
    assert.equal(whalePaint[0][1], "#fff")
    assert.equal(whalePaint[0][2], 1)
  })

  it("botShapeForRole 对已知角色稳定映射（含大小写/空白容错）", () => {
    assert.equal(mod.botShapeForRole("project_architect"), "whale")
    assert.equal(mod.botShapeForRole("agent_engineer"), "star")
    assert.equal(mod.botShapeForRole("frontend_designer"), "moon")
    assert.equal(mod.botShapeForRole("knowledge_manager"), "squircle")
    assert.equal(mod.botShapeForRole("qa_engineer"), "gumdrop")
    assert.equal(mod.botShapeForRole("operations_engineer"), "squircle")
    assert.equal(mod.botShapeForRole(" QA_ENGINEER "), "gumdrop")
    for (const role of [
      "project_architect",
      "agent_engineer",
      "frontend_designer",
      "knowledge_manager",
      "qa_engineer",
      "operations_engineer",
    ]) {
      assert.equal(mod.botShapeForRole(role), mod.botShapeForRole(role))
      assert.ok(SHAPE_IDS.includes(mod.botShapeForRole(role)))
    }
  })

  it("botShapeForRole 对未知/空角色走确定性兜底", () => {
    for (const role of ["unknown_role", "", null, undefined, "外部节点"]) {
      const first = mod.botShapeForRole(role)
      assert.ok(SHAPE_IDS.includes(first))
      assert.equal(first, mod.botShapeForRole(role))
    }
  })

  it("botShapeForSeed 确定且总落在合法集合", () => {
    for (const seed of [1, 42, "agent-1", "测试专员"]) {
      const shape = mod.botShapeForSeed(seed)
      assert.ok(SHAPE_IDS.includes(shape))
      assert.equal(shape, mod.botShapeForSeed(seed))
    }
  })

  it("isBotShapeId 只接受内置形状 id", () => {
    for (const id of SHAPE_IDS) {
      assert.equal(mod.isBotShapeId(id), true)
    }
    for (const value of [null, undefined, "", "wave", 42, {}]) {
      assert.equal(mod.isBotShapeId(value), false)
    }
  })

  it("botShapeLabel 返回可读标签", () => {
    for (const id of SHAPE_IDS) {
      const label = mod.botShapeLabel(id)
      assert.equal(typeof label, "string")
      assert.ok(label.length > 0)
    }
  })
})

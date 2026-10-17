import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("dag-layout", () => {
  const mod = loadTsModule("./src/lib/dag-layout.ts")

  // 注意：被测模块在 vm 上下文里执行，其返回的数组属于**另一个 realm**，
  // 直接 deepStrictEqual 会因原型不同而报 "same structure but not reference-equal"。
  // 这里用宿主 realm 的 Array.from 归一化，再断言结构。
  const ids = (layers) => Array.from(layers, (layer) => Array.from(layer.nodes, (n) => n.id))

  it("空输入返回空分层", () => {
    assert.deepEqual(Array.from(mod.layoutDag([])), [])
  })

  it("单节点为单层", () => {
    assert.deepEqual(ids(mod.layoutDag([{ id: "a" }])), [["a"]])
  })

  it("无依赖的多个节点同层（可并行）", () => {
    const layers = mod.layoutDag([{ id: "a" }, { id: "b" }, { id: "c" }])
    assert.equal(layers.length, 1)
    assert.deepEqual(Array.from(layers[0].nodes, (n) => n.id), ["a", "b", "c"])
  })

  it("A→B、A→C、B&C→D 分三层", () => {
    const layers = mod.layoutDag([
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["a"] },
      { id: "d", dependencies: ["b", "c"] },
    ])
    assert.deepEqual(ids(layers), [["a"], ["b", "c"], ["d"]])
    assert.deepEqual(Array.from(layers, (l) => l.index), [0, 1, 2])
  })

  it("未知依赖与自依赖被忽略，不阻断分层", () => {
    const layers = mod.layoutDag([
      { id: "a", dependencies: ["ghost", "a"] },
      { id: "b", dependencies: ["a"] },
    ])
    assert.deepEqual(ids(layers), [["a"], ["b"]])
  })

  it("重复依赖只计一次入度", () => {
    const layers = mod.layoutDag([
      { id: "a" },
      { id: "b", dependencies: ["a", "a", "a"] },
    ])
    assert.deepEqual(ids(layers), [["a"], ["b"]])
  })

  it("环不导致死循环，环内节点兜底为最后一层且不丢节点", () => {
    const layers = mod.layoutDag([
      { id: "root" },
      { id: "x", dependencies: ["y"] },
      { id: "y", dependencies: ["x"] },
    ])
    assert.deepEqual(ids(layers), [["root"], ["x", "y"]])
  })

  it("重复 id 只保留首个", () => {
    const layers = mod.layoutDag([
      { id: "a", name: "first" },
      { id: "a", name: "second" },
    ])
    assert.equal(layers.length, 1)
    assert.equal(layers[0].nodes.length, 1)
    assert.equal(layers[0].nodes[0].name, "first")
  })

  it("layoutPositions 按层给出行坐标、层内给出横向坐标", () => {
    const positions = mod.layoutPositions([
      { id: "a" },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["a"] },
    ])
    const byId = Object.fromEntries(Array.from(positions, (p) => [p.node.id, p]))
    assert.deepEqual([byId.a.x, byId.a.y], [0, 0])
    assert.ok(byId.b.y > byId.a.y)
    assert.equal(byId.b.y, byId.c.y)
    assert.ok(byId.c.x > byId.b.x)
  })

  it("12 节点宽层与汇点：分层不退化（1 根 → 10 并行 → 1 汇）", () => {
    const nodes = [{ id: "root" }]
    for (let i = 1; i <= 10; i += 1) nodes.push({ id: `w${i}`, dependencies: ["root"] })
    nodes.push({
      id: "sink",
      dependencies: Array.from({ length: 10 }, (_, i) => `w${i + 1}`),
    })
    const layers = mod.layoutDag(nodes)
    assert.deepEqual(Array.from(layers, (l) => l.nodes.length), [1, 10, 1])
  })
})

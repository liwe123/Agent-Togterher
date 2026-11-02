import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { loadTsModule } from "./load-ts-module.mjs"

describe("motion", () => {
  const mod = loadTsModule("./src/lib/motion.ts")
  const css = fs.readFileSync(path.resolve(import.meta.dirname, "../src/app/globals.css"), "utf8")

  it("reproduces the DS-Bot spring settle durations", () => {
    assert.equal(mod.SPRING.shape.duration, 420)
    assert.equal(mod.SPRING.tap.duration, 290)
    assert.equal(mod.SPRING.list.duration, 190)
    assert.equal(mod.SPRING.stretch.duration, 560)
    assert.equal(mod.SPRING.pop.duration, 430)
    assert.equal(mod.SPRING.lead.duration, 320)
    assert.equal(mod.SPRING.trail.duration, 300)
    assert.equal(mod.SPRING.glide.duration, 290)
  })

  it("emits 25-stop CSS linear() easings", () => {
    for (const curve of Object.values(mod.SPRING)) {
      assert.match(curve.easing, /^linear\(/, "starts with linear(")
      const stops = curve.easing.slice(7, -1).split(",")
      assert.equal(stops.length, 25)
      assert.equal(stops[0], "0.0000")
      assert.equal(stops[24], "1.0000")
      for (const stop of stops) {
        assert.ok(Number.isFinite(Number(stop)), `${stop} is finite`)
      }
    }
  })

  it("keeps globals.css tokens in sync with the generated curves", () => {
    for (const [name, curve] of Object.entries(mod.SPRING)) {
      if (!["shape", "tap", "list", "pop", "stretch", "lead", "trail", "glide"].includes(name)) continue
      assert.ok(
        css.includes(`--console-dur-${name}: ${curve.duration}ms;`),
        `globals.css missing duration token for ${name}`,
      )
      assert.ok(
        css.includes(`--console-ease-${name}: ${curve.easing};`),
        `globals.css missing easing token for ${name}`,
      )
    }
  })

  it("builds transition shorthands", () => {
    assert.equal(
      mod.springTransition(mod.SPRING.shape, "height", "opacity"),
      `height 420ms ${mod.SPRING.shape.easing}, opacity 420ms ${mod.SPRING.shape.easing}`,
    )
  })

  it("treats non-browser environments as no reduced-motion", () => {
    assert.equal(mod.prefersReducedMotion(), false)
  })
})

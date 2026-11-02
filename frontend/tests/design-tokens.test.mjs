import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("design-tokens", () => {
  const mod = loadTsModule("./src/lib/design-tokens.ts")
  const KEYS = ["bg", "sidebar", "bubble", "card", "text", "user", "userText", "accent"]

  it("defines 4 themes with exactly the DS-Bot 8 color keys in both modes", () => {
    assert.equal(mod.THEMES.length, 4)
    for (const theme of mod.THEMES) {
      for (const mode of ["light", "dark"]) {
        assert.deepEqual(Object.keys(theme[mode]).sort(), [...KEYS].sort(), `${theme.id}.${mode}`)
        for (const key of KEYS) {
          assert.match(theme[mode][key], /^#[0-9a-f]{6}$/i, `${theme.id}.${mode}.${key}`)
        }
      }
    }
    assert.deepEqual([...mod.THEMES.map((theme) => theme.id)], ["deepseek", "mono", "paper", "moonlight"])
  })

  it("keeps the exact DS-Bot deepseek palette", () => {
    const deepseek = mod.THEMES.find((theme) => theme.id === "deepseek")
    assert.equal(deepseek.dark.bg, "#141414")
    assert.equal(deepseek.dark.card, "#1f1f1f")
    assert.equal(deepseek.dark.accent, "#5b7bff")
    assert.equal(deepseek.light.bg, "#fcfcfc")
  })

  it("derives accent foreground with the DS-Bot luminance threshold", () => {
    assert.equal(mod.accentInk("#5b7bff"), "#141414")
    assert.equal(mod.accentInk("#4d6bfe"), "#ffffff")
    assert.equal(mod.accentInk("#0d0d0d"), "#ffffff")
    assert.equal(mod.accentInk("#f4f4f4"), "#141414")
    assert.equal(mod.accentInk("#d97757"), "#141414")
    assert.equal(mod.accentInk("#1e86ff"), "#141414")
    assert.equal(mod.accentInk("#000000"), "#ffffff")
    assert.equal(mod.accentInk("#ffffff"), "#141414")
  })

  it("validates hex values", () => {
    assert.equal(mod.isHex("#4d6bfe"), true)
    assert.equal(mod.isHex("#4D6BFE"), true)
    assert.equal(mod.isHex("4d6bfe"), false)
    assert.equal(mod.isHex("#4d6bf"), false)
    assert.equal(mod.isHex("#gggggg"), false)
  })

  it("maps a preset light accent to its dark twin (DS-Bot darkAccent)", () => {
    assert.equal(mod.darkAccent("#4D6BFE"), "#6A84FF")
    assert.equal(mod.darkAccent("#EC2F6B"), "#FF5A7A")
    assert.equal(mod.darkAccent("#123456"), "#123456")
    assert.equal(mod.darkAccent(null), null)
  })

  it("resolves accent by theme default / preset / custom hex", () => {
    assert.equal(mod.resolveAccent("deepseek", "dark", null), "#5b7bff")
    assert.equal(mod.resolveAccent("deepseek", "light", null), "#4d6bfe")
    assert.equal(mod.resolveAccent("mono", "light", null), "#0d0d0d")
    assert.equal(mod.resolveAccent("deepseek", "dark", "rose"), "#FF5A7A")
    assert.equal(mod.resolveAccent("deepseek", "light", "rose"), "#EC2F6B")
    assert.equal(mod.resolveAccent("deepseek", "dark", "#4D6BFE"), "#6A84FF")
    assert.equal(mod.resolveAccent("deepseek", "light", "#4D6BFE"), "#4D6BFE")
    assert.equal(mod.resolveAccent("deepseek", "dark", "bogus"), "#5b7bff")
  })

  it("exposes the 7 accent presets and 19 inks", () => {
    assert.equal(mod.ACCENT_PRESETS.length, 7)
    assert.equal(Object.keys(mod.INKS).length, 19)
    assert.deepEqual(
      [...mod.ACCENT_PRESETS.map((preset) => preset.id)],
      ["deepseek", "charcoal", "graphite", "rose", "sky", "tangerine", "cobalt"],
    )
  })

  it("exposes stable storage keys", () => {
    assert.equal(mod.STORAGE_KEYS.theme, "console.theme")
    assert.equal(mod.STORAGE_KEYS.accent, "console.accent")
    assert.equal(mod.STORAGE_KEYS.mode, "console.mode")
    assert.equal(mod.STORAGE_KEYS.motion, "console.motion")
    assert.equal(mod.STORAGE_KEYS.panelWidth, "console.panelW")
  })

  it("validates persisted preference values", () => {
    assert.equal(mod.isThemeId("paper"), true)
    assert.equal(mod.isThemeId("unknown"), false)
    assert.equal(mod.isColorMode("light"), true)
    assert.equal(mod.isColorMode("auto"), false)
    assert.equal(mod.isMotionLevel("lively"), true)
    assert.equal(mod.isMotionLevel("fast"), false)
  })
})

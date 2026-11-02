import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { loadTsModule } from "./load-ts-module.mjs"

const SRC = path.resolve(import.meta.dirname, "../src")
const ALLOWED_TYPES = new Set(["path", "circle", "rect", "line", "polyline", "polygon"])
const ALLOWED_SW = new Set([1.5, 1.6, 1.8])

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(target))
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(target)
  }
  return out
}

describe("icon-paths", () => {
  const mod = loadTsModule("./src/lib/icon-paths.ts")
  const icons = mod.ICONS
  const names = Object.keys(icons)

  it("registers at least 75 icons", () => {
    assert.ok(names.length >= 75, `expected >=75 icons, got ${names.length}`)
  })

  it("uses kebab-case names and unique keys", () => {
    assert.equal(new Set(names).size, names.length)
    for (const name of names) {
      assert.match(name, /^[a-z][a-z0-9-]*$/, name)
    }
  })

  it("draws every icon on the 20x20 grid with valid primitives", () => {
    for (const [name, def] of Object.entries(icons)) {
      assert.ok(Array.isArray(def.prims) && def.prims.length > 0, name + " has primitives")
      for (const prim of def.prims) {
        assert.ok(ALLOWED_TYPES.has(prim.t), `${name}: unknown primitive ${prim.t}`)
        if (prim.t === "path") {
          assert.ok(typeof prim.d === "string" && prim.d.length > 4, `${name}: path data too short`)
          assert.match(prim.d, /^[Mm]/, `${name}: path must start with M/m`)
        }
        if (prim.t === "circle") {
          for (const key of ["cx", "cy", "r"]) assert.ok(Number.isFinite(prim[key]), `${name}: ${key}`)
          assert.ok(prim.cx >= 0 && prim.cx <= 20 && prim.cy >= 0 && prim.cy <= 20, `${name}: circle outside grid`)
          assert.ok(prim.r > 0 && prim.r <= 20, `${name}: radius`)
        }
        if (prim.t === "rect") {
          assert.ok(prim.w > 0 && prim.h > 0, `${name}: rect size`)
          assert.ok(prim.x >= 0 && prim.y >= 0, `${name}: rect origin`)
          assert.ok(prim.x + prim.w <= 20.5 && prim.y + prim.h <= 20.5, `${name}: rect outside grid`)
        }
        if (prim.t === "line") {
          for (const key of ["x1", "y1", "x2", "y2"]) assert.ok(Number.isFinite(prim[key]), `${name}: ${key}`)
        }
        if (prim.t === "polyline" || prim.t === "polygon") {
          assert.ok(typeof prim.points === "string" && prim.points.length > 4, `${name}: points`)
        }
        if (prim.sw !== undefined) assert.ok(ALLOWED_SW.has(prim.sw), `${name}: primitive stroke width ${prim.sw}`)
        assert.ok(["boolean", "undefined"].includes(typeof prim.fill), `${name}: fill must be a boolean flag`)
      }
      if (def.sw !== undefined) assert.ok(ALLOWED_SW.has(def.sw), `${name}: stroke width ${def.sw}`)
      if (def.transform !== undefined) assert.match(def.transform, /^(translate|scale|rotate)\(/, `${name}: transform`)
      // 不允许硬编码颜色：路径注册表只存几何数据
      assert.ok(!JSON.stringify(def).includes("#"), `${name}: hardcoded color found`)
    }
  })

  it("maps every historical lucide name to an existing icon (95 names)", () => {
    const map = mod.ICON_COMPONENT_MAP
    const componentNames = Object.keys(map)
    assert.equal(componentNames.length, 95)
    for (const [component, iconName] of Object.entries(map)) {
      assert.ok(names.includes(iconName), `${component} -> ${iconName} missing`)
    }
  })

  it("exposes the same name list through ICON_COMPONENT_NAMES and ICON_NAMES", () => {
    assert.equal(mod.ICON_COMPONENT_NAMES.length, 95)
    assert.equal(mod.ICON_NAMES.length, names.length)
    for (const name of names) assert.equal(mod.isIconName(name), true)
    assert.equal(mod.isIconName("not-an-icon"), false)
  })
})

describe("icon components", () => {
  const source = fs.readFileSync(path.join(SRC, "components/ui/icons.tsx"), "utf8")
  const paths = loadTsModule("./src/lib/icon-paths.ts")
  const componentNames = Object.keys(paths.ICON_COMPONENT_MAP)

  it("exports one wrapper component per historical icon name", () => {
    for (const name of componentNames) {
      assert.ok(
        source.includes(`export const ${name} = createIcon(ICON_COMPONENT_MAP.${name})`),
        `missing wrapper export: ${name}`,
      )
    }
    const wrapperCount = (source.match(/export const [A-Za-z0-9_]+ = createIcon/g) || []).length
    assert.ok(wrapperCount >= componentNames.length, `expected >= ${componentNames.length} wrappers, got ${wrapperCount}`)
  })

  it("renders all icons on the DS-Bot 20x20 canvas with currentColor", () => {
    assert.ok(source.includes('viewBox="0 0 20 20"'), "viewBox 0 0 20 20")
    assert.ok(source.includes('stroke="currentColor"'), "stroke currentColor")
    assert.ok(source.includes('fill="none"'), "default fill none")
    assert.ok(source.includes("strokeLinecap=\"round\""), "round caps")
    assert.ok(source.includes("strokeLinejoin=\"round\""), "round joins")
    assert.ok(source.includes("aria-hidden"), "aria-hidden default")
  })
})

describe("icon migration hygiene", () => {
  const files = walk(SRC)

  it("has no remaining lucide-react imports", () => {
    const offenders = files.filter((file) => /from\s+["']lucide-react["']/.test(fs.readFileSync(file, "utf8")))
    assert.deepEqual(offenders.map((file) => path.relative(SRC, file)), [])
  })

  it("does not depend on lucide-react in package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"))
    assert.equal(pkg.dependencies?.["lucide-react"], undefined)
    assert.equal(pkg.devDependencies?.["lucide-react"], undefined)
  })

  it("has no emoji iconography left in source", () => {
    const offenders = []
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8")
      if (text.includes("✕") || text.includes("🤖")) offenders.push(path.relative(SRC, file))
    }
    assert.deepEqual(offenders, [])
  })

  it("keeps icon components free of hardcoded palette classes", () => {
    const source = fs.readFileSync(path.join(SRC, "components/ui/icons.tsx"), "utf8")
    assert.ok(!/text-(red|blue|green|amber|purple|emerald)-\d/.test(source))
    assert.ok(source.includes("currentColor"))
  })
})

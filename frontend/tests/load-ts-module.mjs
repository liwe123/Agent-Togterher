import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const baseRequire = createRequire(import.meta.url)

export function loadTsModule(relativePath, extraContext = {}, cache = new Map()) {
  const filename = path.resolve(relativePath)
  if (cache.has(filename)) {
    return cache.get(filename).exports
  }

  const dir = path.dirname(filename)
  const source = fs.readFileSync(filename, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText

  const testModule = { exports: {} }
  cache.set(filename, testModule)

  const customRequire = (id) => {
    if (id.startsWith("./") || id.startsWith("../")) {
      const candidates = [
        path.resolve(dir, id),
        path.resolve(dir, `${id}.ts`),
        path.resolve(dir, `${id}.tsx`),
        path.resolve(dir, `${id}.js`),
        path.resolve(dir, `${id}.mjs`),
      ]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return loadTsModule(candidate, extraContext, cache)
        }
      }
    }
    return baseRequire(id)
  }

  const context = vm.createContext({
    module: testModule,
    exports: testModule.exports,
    require: customRequire,
    process,
    console,
    ...extraContext,
  })
  vm.runInContext(compiled, context, { filename })
  return testModule.exports
}

import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"

const require = createRequire(import.meta.url)

export function loadTsModule(relativePath, extraContext = {}) {
  const filename = path.resolve(relativePath)
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
  const context = vm.createContext({
    module: testModule,
    exports: testModule.exports,
    require,
    process,
    console,
    ...extraContext,
  })
  vm.runInContext(compiled, context, { filename })
  return testModule.exports
}

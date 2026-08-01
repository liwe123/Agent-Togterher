import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { loadTsModule } from "./load-ts-module.mjs"

describe("requestData", () => {
  it("unwraps a success envelope and returns the data payload", async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ success: true, data: { id: 42, name: "test" } }),
    })
    const mod = loadTsModule("./src/lib/task-api.ts", { fetch: mockFetch })
    const result = await mod.requestData("/api/test")
    assert.deepStrictEqual(result, { id: 42, name: "test" })
  })

  it("rejects when success envelope is false", async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ success: false, error: "something went wrong" }),
    })
    const mod = loadTsModule("./src/lib/task-api.ts", { fetch: mockFetch })
    await assert.rejects(mod.requestData("/api/test"), /something went wrong/)
  })

  it("rejects when response is not ok with detail array (FastAPI validation)", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [{ msg: "field required" }, { msg: "invalid type" }],
      }),
    })
    const mod = loadTsModule("./src/lib/task-api.ts", { fetch: mockFetch })
    await assert.rejects(mod.requestData("/api/test"), /field required; invalid type/)
  })
})

import test from "node:test"
import assert from "node:assert/strict"

import { loadTsModule } from "./load-ts-module.mjs"

test("requestData surfaces non-envelope API error messages", async () => {
  const { requestData } = loadTsModule("src/lib/task-api.ts", {
    fetch: async () => ({
      ok: false,
      status: 502,
      json: async () => ({ detail: "upstream unavailable" }),
    }),
  })

  await assert.rejects(
    requestData("/api/models/test"),
    /upstream unavailable/,
  )
})

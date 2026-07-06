import test from "node:test"
import assert from "node:assert/strict"

import { loadTsModule } from "./load-ts-module.mjs"

test("selectConsoleAgents keeps websocket workspace and visible agents in sync", () => {
  const { selectConsoleAgents } = loadTsModule("src/lib/agent-console-data.ts")
  const agents = [
    { id: 1, workspace_id: 10, name: "Workspace 10 A" },
    { id: 2, workspace_id: 20, name: "Workspace 20 A" },
    { id: 3, workspace_id: 10, name: "Workspace 10 B" },
  ]

  const result = selectConsoleAgents(agents, 10)

  assert.equal(result.workspaceId, 10)
  assert.deepEqual(
    result.agents.map((agent) => agent.id),
    [1, 3],
  )
})

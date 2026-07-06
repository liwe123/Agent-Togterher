interface WorkspaceScopedAgent {
  workspace_id: number
}

export function selectConsoleAgents<T extends WorkspaceScopedAgent>(
  agents: T[],
  workspaceId: number,
): { workspaceId: number; agents: T[] } {
  return {
    workspaceId,
    agents: agents.filter((agent) => agent.workspace_id === workspaceId),
  }
}

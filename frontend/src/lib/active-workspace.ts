"use client"

import type { Workspace } from "@/types/chat"
import type { MyWorkspace } from "@/types/membership"

export const ACTIVE_WORKSPACE_KEY = "agent_console_active_workspace_id"

export const WORKSPACE_SWITCH_EVENT = "agent-console:workspace-switched"

export function readActiveWorkspaceId(): number | null {
  if (typeof window === "undefined") return null
  const savedId = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
  if (savedId === null) return null
  const parsed = Number(savedId)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function pickActiveWorkspace(
  workspaces: MyWorkspace[],
): MyWorkspace | null {
  if (workspaces.length === 0) return null
  const savedId = readActiveWorkspaceId()
  if (savedId !== null) {
    const matched = workspaces.find((ws) => ws.id === savedId)
    if (matched) return matched
  }
  return workspaces[0]
}

export function toWorkspace(myWorkspace: MyWorkspace): Workspace {
  return {
    id: myWorkspace.id,
    name: myWorkspace.name,
    description: myWorkspace.description,
    created_at: myWorkspace.joined_at,
  }
}

export function activateWorkspace(workspaceId: number): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspaceId))
    window.dispatchEvent(
      new CustomEvent<number>(WORKSPACE_SWITCH_EVENT, {
        detail: workspaceId,
      }),
    )
  }
}

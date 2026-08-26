"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { requestData } from "@/lib/task-api"
import type { MyWorkspace, WorkspaceRole } from "@/types/membership"
import {
  ACTIVE_WORKSPACE_KEY,
  activateWorkspace,
  readActiveWorkspaceId,
} from "@/lib/active-workspace"

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<MyWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  const activeWorkspace =
    workspaces.find((ws) => ws.id === activeWorkspaceId) || workspaces[0] || null

  const currentUserRole: WorkspaceRole = activeWorkspace?.role || "viewer"

  const loadWorkspaces = useCallback(async () => {
    try {
      const data = await requestData<MyWorkspace[]>("/api/v1/workspaces/my")
      setWorkspaces(data)
      if (data.length > 0) {
        const savedId = readActiveWorkspaceId()
        const matched = data.find((ws) => ws.id === savedId)
        const targetId = matched ? matched.id : data[0].id
        setActiveWorkspaceId(targetId)
        if (typeof window !== "undefined") {
          localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(targetId))
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "获取工作区失败")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    void loadWorkspaces()
  }, [loadWorkspaces])

  const switchWorkspace = useCallback((workspaceId: number) => {
    setActiveWorkspaceId(workspaceId)
    activateWorkspace(workspaceId)
  }, [])

  const createWorkspace = useCallback(
    async (name: string, description: string = "") => {
      const newWs = await requestData<MyWorkspace>("/api/v1/workspaces", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      })
      await loadWorkspaces()
      switchWorkspace(newWs.id)
      return newWs
    },
    [loadWorkspaces, switchWorkspace]
  )

  const joinWorkspace = useCallback(
    async (inviteCode: string) => {
      const joinedWs = await requestData<MyWorkspace>("/api/v1/workspaces/join", {
        method: "POST",
        body: JSON.stringify({ invite_code: inviteCode }),
      })
      await loadWorkspaces()
      switchWorkspace(joinedWs.id)
      return joinedWs
    },
    [loadWorkspaces, switchWorkspace]
  )

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    currentUserRole,
    isLoading,
    error,
    refreshWorkspaces: loadWorkspaces,
    switchWorkspace,
    createWorkspace,
    joinWorkspace,
  }
}

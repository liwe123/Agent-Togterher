"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { useWorkspaceSocket } from "@/hooks/use-workspace-socket"
import { requestData } from "@/lib/task-api"
import type { IntegrationNode } from "@/types/integration"

type IntegrationEvent = {
  type?: string
  payload?: unknown
}

export function useIntegrations(workspaceId: number | null) {
  const [nodes, setNodes] = useState<IntegrationNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const fetchedRef = useRef(false)

  const refresh = useCallback(() => {
    fetchedRef.current = false
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    if (workspaceId === null || fetchedRef.current) return
    fetchedRef.current = true

    const controller = new AbortController()

    async function loadNodes() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await requestData<IntegrationNode[]>(
          `/api/v1/integrations/nodes?workspace_id=${workspaceId}`,
          { signal: controller.signal },
        )
        setNodes(data)
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "获取节点失败")
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadNodes()
    return () => controller.abort()
  }, [workspaceId, requestVersion])

  useWorkspaceSocket({
    workspaceId,
    onEvent: useCallback((event) => {
      const e = event as IntegrationEvent
      if (e.type === "integration.status_changed" || e.type === "integration.heartbeat") {
        const payload = e.payload as IntegrationNode
        setNodes((current) => {
          const idx = current.findIndex((node) => node.id === payload.id)
          if (idx === -1) {
            return [payload, ...current]
          }
          const updated = [...current]
          updated[idx] = payload
          return updated
        })
      }
    }, []),
    onStatusChange: () => {
      // integration dock uses websocket indirectly; status is handled in parent console
    },
  })

  return {
    nodes,
    isLoading,
    error,
    refresh,
  }
}

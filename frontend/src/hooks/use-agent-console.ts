"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type {
  Agent,
  ConnectionStatus,
  RecentOutput,
  WorkspaceEvent,
} from "@/types/agent"
import type { MyWorkspace } from "@/types/membership"

import { requestData } from "@/lib/task-api"
import { useWorkspaceSocket } from "@/hooks/use-workspace-socket"
import {
  WORKSPACE_SWITCH_EVENT,
  pickActiveWorkspace,
  toWorkspace,
} from "@/lib/active-workspace"

export function useAgentConsole() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [recentOutputs, setRecentOutputs] = useState<RecentOutput[]>([])
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const fetchedRef = useRef(false)

  const retry = useCallback(() => {
    fetchedRef.current = false
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const handleWorkspaceSwitch = () => retry()
    window.addEventListener(WORKSPACE_SWITCH_EVENT, handleWorkspaceSwitch)
    return () =>
      window.removeEventListener(WORKSPACE_SWITCH_EVENT, handleWorkspaceSwitch)
  }, [retry])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const controller = new AbortController()

    async function loadAgents() {
      setIsLoading(true)
      setError(null)

      try {
        const myWorkspaces = await requestData<MyWorkspace[]>(
          "/api/v1/workspaces/my",
          { signal: controller.signal },
        )
        const active = pickActiveWorkspace(myWorkspaces)
        if (!active) {
          throw new Error("没有可用工作区，请先启动后端完成默认数据初始化。")
        }
        const currentWorkspace = toWorkspace(active)

        const agentsData = await requestData<Agent[]>(
          `/api/agents?workspace_id=${currentWorkspace.id}`,
          { signal: controller.signal },
        )
        setWorkspaceId(currentWorkspace.id)
        setWorkspaceName(currentWorkspace.name)
        setAgents(agentsData)
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "无法连接 Agent API，请确认后端已在 8000 端口启动。",
          )
          setConnectionStatus("offline")
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadAgents()
    return () => controller.abort()
  }, [requestVersion])

  useWorkspaceSocket({
    workspaceId,
    onEvent: useCallback((event) => {
      const e = event as WorkspaceEvent

      if (e.type === "agent.status_changed") {
        const payload = e.payload
        setAgents((currentAgents) =>
          currentAgents.map((agent) =>
            agent.id === payload.id
              ? {
                  ...agent,
                  status: payload.status,
                  last_active_at: payload.last_active_at,
                }
              : agent,
          ),
        )
      }

      if (
        e.type === "message.created" &&
        e.payload.sender_type === "agent" &&
        e.payload.sender_id !== null
      ) {
        const payload = e.payload
        setRecentOutputs((outputs) => [
          {
            id: payload.id,
            agentId: payload.sender_id as number,
            content: payload.content,
            createdAt: payload.created_at,
          },
          ...outputs.filter((output) => output.id !== payload.id),
        ].slice(0, 4))
      }
    }, []),
    onStatusChange: setConnectionStatus,
  })

  return {
    agents,
    recentOutputs,
    connectionStatus,
    isLoading,
    error,
    retry,
    workspaceName,
  }
}

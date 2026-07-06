"use client"

import { useCallback, useEffect, useState } from "react"

import type {
  Agent,
  ConnectionStatus,
  RecentOutput,
  WorkspaceEvent,
} from "@/types/agent"
import type { Workspace } from "@/types/chat"

import { selectConsoleAgents } from "@/lib/agent-console-data"
import { requestData, websocketBaseUrl } from "@/lib/task-api"

export function useAgentConsole() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [recentOutputs, setRecentOutputs] = useState<RecentOutput[]>([])
  const [workspaceId, setWorkspaceId] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadAgents() {
      setIsLoading(true)
      setError(null)

      try {
        const workspaces = await requestData<Workspace[]>("/api/workspaces", {
          signal: controller.signal,
        })
        const currentWorkspace = workspaces[0]
        if (!currentWorkspace) {
          throw new Error("没有可用工作区，请先启动后端完成默认数据初始化。")
        }

        const agentsData = await requestData<Agent[]>(
          `/api/agents?workspace_id=${currentWorkspace.id}`,
          { signal: controller.signal },
        )
        const selected = selectConsoleAgents(agentsData, currentWorkspace.id)
        setWorkspaceId(selected.workspaceId)
        setAgents(selected.agents)
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

  useEffect(() => {
    if (workspaceId === null) {
      return
    }

    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let shouldReconnect = true

    function connect() {
      setConnectionStatus("connecting")
      socket = new WebSocket(
        `${websocketBaseUrl}/ws/workspaces/${workspaceId}`,
      )

      socket.onopen = () => setConnectionStatus("online")
      socket.onerror = () => setConnectionStatus("offline")
      socket.onclose = () => {
        setConnectionStatus("offline")
        if (shouldReconnect) {
          retryTimer = setTimeout(connect, 3000)
        }
      }
      socket.onmessage = (message) => {
        let event: WorkspaceEvent
        try {
          event = JSON.parse(message.data) as WorkspaceEvent
        } catch {
          setError("收到无法解析的控制台实时消息。")
          return
        }

        if (event.type === "agent.status_changed") {
          const payload = event.payload
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
          event.type === "message.created" &&
          event.payload.sender_type === "agent" &&
          event.payload.sender_id !== null
        ) {
          const payload = event.payload
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
      }
    }

    connect()

    return () => {
      shouldReconnect = false
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
      }
      socket?.close()
    }
  }, [workspaceId])

  return {
    agents,
    recentOutputs,
    connectionStatus,
    isLoading,
    error,
    retry,
  }
}

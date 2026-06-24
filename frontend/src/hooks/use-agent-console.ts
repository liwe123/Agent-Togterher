"use client"

import { useCallback, useEffect, useState } from "react"

import type {
  Agent,
  ApiResponse,
  ConnectionStatus,
  RecentOutput,
  WorkspaceEvent,
} from "@/types/agent"

import { apiBaseUrl, websocketBaseUrl } from "@/lib/task-api"

export function useAgentConsole() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [recentOutputs, setRecentOutputs] = useState<RecentOutput[]>([])
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
        const response = await fetch(`${apiBaseUrl}/api/agents`, {
          signal: controller.signal,
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error(`Agent API 返回 ${response.status}`)
        }

        const result = (await response.json()) as ApiResponse<Agent[]>
        setAgents(result.data)
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError("无法连接 Agent API，请确认后端已在 8000 端口启动。")
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

  const workspaceId = agents[0]?.workspace_id ?? null

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
        const event = JSON.parse(message.data) as WorkspaceEvent

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

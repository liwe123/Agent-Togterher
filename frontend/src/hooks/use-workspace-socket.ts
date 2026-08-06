"use client"

import { useEffect, useRef } from "react"
import type { ConnectionStatus } from "@/types/agent"
import { websocketBaseUrl } from "@/lib/task-api"
import { RECONNECT_DELAY_MS } from "@/lib/constants"

type EventHandler = (event: unknown) => void

interface UseWorkspaceSocketOptions {
  workspaceId: number | null
  onEvent: EventHandler
  onStatusChange: (status: ConnectionStatus) => void
}

export function useWorkspaceSocket({
  workspaceId,
  onEvent,
  onStatusChange,
}: UseWorkspaceSocketOptions) {
  const onEventRef = useRef(onEvent)
  const onStatusChangeRef = useRef(onStatusChange)
  useEffect(() => {
    onEventRef.current = onEvent
    onStatusChangeRef.current = onStatusChange
  })

  useEffect(() => {
    if (workspaceId === null) return

    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let shouldReconnect = true

    function connect() {
      onStatusChangeRef.current("connecting")
      socket = new WebSocket(
        `${websocketBaseUrl}/ws/workspaces/${workspaceId}`,
      )
      socket.onopen = () => onStatusChangeRef.current("online")
      socket.onerror = () => onStatusChangeRef.current("offline")
      socket.onclose = () => {
        onStatusChangeRef.current("offline")
        if (shouldReconnect) {
          retryTimer = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data)
          onEventRef.current(event)
        } catch {
          onEventRef.current({ type: "error", payload: { message: "收到无法解析的实时消息。" } })
        }
      }
    }

    connect()

    return () => {
      shouldReconnect = false
      if (retryTimer !== null) clearTimeout(retryTimer)
      socket?.close()
    }
  }, [workspaceId])
}

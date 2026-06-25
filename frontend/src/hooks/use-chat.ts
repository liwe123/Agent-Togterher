"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { Agent, ConnectionStatus } from "@/types/agent"
import type {
  ChatMessage,
  ChatTask,
  ChatWorkspaceEvent,
  Conversation,
  MessageHubResult,
  Workspace,
} from "@/types/chat"
import { requestData, websocketBaseUrl } from "@/lib/task-api"

const conversationListLimit = 20
const messageListLimit = 200
const taskListLimit = 100
const terminalTaskStatuses = new Set(["completed", "failed", "cancelled"])

function upsertMessage(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id)
  if (existingIndex === -1) {
    return [...messages, message].sort((left, right) => {
      const timeDifference =
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      return timeDifference === 0 ? left.id - right.id : timeDifference
    })
  }

  return messages.map((item) => (item.id === message.id ? message : item))
}

function taskTimestamp(task: ChatTask): number {
  const timestamp = Date.parse(task.updated_at)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function taskStatusRank(status: string): number {
  if (terminalTaskStatuses.has(status)) return 2
  return status === "running" ? 1 : 0
}

function shouldReplaceTask(existing: ChatTask, next: ChatTask): boolean {
  const existingTime = taskTimestamp(existing)
  const nextTime = taskTimestamp(next)
  if (nextTime !== existingTime) return nextTime > existingTime
  return taskStatusRank(next.status) >= taskStatusRank(existing.status)
}

function upsertTask(tasks: ChatTask[], task: ChatTask): ChatTask[] {
  const existingIndex = tasks.findIndex((item) => item.id === task.id)
  if (existingIndex === -1) {
    return [task, ...tasks]
  }

  return tasks.map((item) =>
    item.id === task.id && shouldReplaceTask(item, task) ? task : item,
  )
}

export function useChat() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [tasks, setTasks] = useState<ChatTask[]>([])
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting")
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const localErrorId = useRef(-1)

  const appendErrorMessage = useCallback(
    (message: string, conversationId?: number) => {
      const targetConversationId = conversationId ?? conversation?.id
      if (targetConversationId === undefined) {
        setError(message)
        return
      }

      const errorMessage: ChatMessage = {
        id: localErrorId.current,
        conversation_id: targetConversationId,
        sender_type: "system",
        sender_id: null,
        content: message,
        message_type: "error",
        created_at: new Date().toISOString(),
      }
      localErrorId.current -= 1
      setMessages((current) => [...current, errorMessage])
    },
    [conversation?.id],
  )

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadChat() {
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

        const [workspaceAgents, existingConversations] = await Promise.all([
          requestData<Agent[]>(
            `/api/agents?workspace_id=${currentWorkspace.id}`,
            { signal: controller.signal },
          ),
          requestData<Conversation[]>(
            `/api/conversations?workspace_id=${currentWorkspace.id}&limit=${conversationListLimit}`,
            { signal: controller.signal },
          ),
        ])

        const currentConversation =
          existingConversations[0] ??
          (await requestData<Conversation>("/api/conversations", {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              workspace_id: currentWorkspace.id,
              title: "默认群聊",
            }),
          }))

        const [conversationMessages, workspaceTasks] = await Promise.all([
          requestData<ChatMessage[]>(
            `/api/conversations/${currentConversation.id}/messages?limit=${messageListLimit}`,
            { signal: controller.signal },
          ),
          requestData<ChatTask[]>(
            `/api/tasks?workspace_id=${currentWorkspace.id}&limit=${taskListLimit}`,
            { signal: controller.signal },
          ),
        ])

        if (controller.signal.aborted) {
          return
        }

        setWorkspace(currentWorkspace)
        setConversation(currentConversation)
        setAgents(workspaceAgents)
        setMessages(conversationMessages)
        setTasks(
          workspaceTasks.filter(
            (task) => task.conversation_id === currentConversation.id,
          ),
        )
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "群聊初始化失败。",
          )
          setConnectionStatus("offline")
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadChat()
    return () => controller.abort()
  }, [requestVersion])

  useEffect(() => {
    if (!workspace || !conversation) {
      return
    }

    const workspaceId = workspace.id
    const conversationId = conversation.id
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
      socket.onmessage = (eventMessage) => {
        let event: ChatWorkspaceEvent
        try {
          event = JSON.parse(eventMessage.data) as ChatWorkspaceEvent
        } catch {
          appendErrorMessage("收到无法解析的实时消息。", conversationId)
          return
        }

        if (
          event.type === "message.created" &&
          event.payload.conversation_id === conversationId
        ) {
          setMessages((current) => upsertMessage(current, event.payload))
          return
        }

        if (
          event.type === "task.status_changed" &&
          event.payload.conversation_id === conversationId
        ) {
          setTasks((current) => upsertTask(current, event.payload))
          return
        }

        if (event.type === "agent.status_changed") {
          setAgents((current) =>
            current.map((agent) =>
              agent.id === event.payload.id
                ? {
                    ...agent,
                    status: event.payload.status,
                    last_active_at: event.payload.last_active_at,
                  }
                : agent,
            ),
          )
          return
        }

        if (event.type === "error") {
          appendErrorMessage(event.payload.message, conversationId)
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
  }, [appendErrorMessage, conversation, workspace])

  const sendMessage = useCallback(
    async (content: string): Promise<boolean> => {
      if (!conversation || isSending) {
        return false
      }

      setIsSending(true)
      setError(null)
      try {
        const result = await requestData<MessageHubResult>(
          `/api/conversations/${conversation.id}/messages`,
          {
            method: "POST",
            body: JSON.stringify({
              sender_type: "user",
              content,
            }),
          },
        )
        setMessages((current) => upsertMessage(current, result.message))
        setTasks((current) => upsertTask(current, result.task))
        setAgents((current) =>
          current.map((agent) =>
            agent.id === result.assigned_agent.id
              ? result.assigned_agent
              : agent,
          ),
        )
        return true
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : "消息发送失败。"
        appendErrorMessage(`消息发送失败：${message}`, conversation.id)
        return false
      } finally {
        setIsSending(false)
      }
    },
    [appendErrorMessage, conversation, isSending],
  )

  return {
    workspace,
    conversation,
    agents,
    messages,
    tasks,
    connectionStatus,
    isLoading,
    isSending,
    error,
    retry,
    sendMessage,
  }
}

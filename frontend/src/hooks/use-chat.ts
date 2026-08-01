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
import { requestData } from "@/lib/task-api"
import { CONVERSATION_LIST_LIMIT, MESSAGE_LIST_LIMIT, TASK_LIST_LIMIT } from "@/lib/constants"
import { shouldApplyTaskStatus } from "@/lib/task-utils"
import { useWorkspaceSocket } from "@/hooks/use-workspace-socket"

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

function upsertTask(tasks: ChatTask[], task: ChatTask): ChatTask[] {
  const existingIndex = tasks.findIndex((item) => item.id === task.id)
  if (existingIndex === -1) {
    return [task, ...tasks]
  }

  return tasks.map((item) =>
    item.id === task.id && shouldApplyTaskStatus(item, task) ? task : item,
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
  const fetchedRef = useRef(false)

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
    fetchedRef.current = false
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

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
            `/api/conversations?workspace_id=${currentWorkspace.id}&limit=${CONVERSATION_LIST_LIMIT}`,
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
            `/api/conversations/${currentConversation.id}/messages?limit=${MESSAGE_LIST_LIMIT}`,
            { signal: controller.signal },
          ),
          requestData<ChatTask[]>(
            `/api/tasks?workspace_id=${currentWorkspace.id}&limit=${TASK_LIST_LIMIT}`,
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

  useWorkspaceSocket({
    workspaceId: workspace?.id ?? null,
    onEvent: useCallback((event) => {
      const e = event as ChatWorkspaceEvent
      const conversationId = conversation?.id

      if (
        e.type === "message.created" &&
        e.payload.conversation_id === conversationId
      ) {
        setMessages((current) => upsertMessage(current, e.payload as ChatMessage))
        return
      }

      if (
        e.type === "task.status_changed" &&
        (e.payload as ChatTask).conversation_id === conversationId
      ) {
        setTasks((current) => upsertTask(current, e.payload as ChatTask))
        return
      }

      if (e.type === "agent.status_changed") {
        setAgents((current) =>
          current.map((agent) =>
            agent.id === e.payload.id
              ? {
                  ...agent,
                  status: e.payload.status,
                  last_active_at: e.payload.last_active_at,
                }
              : agent,
          ),
        )
        return
      }

      if (e.type === "error") {
        appendErrorMessage(e.payload.message, conversationId)
      }
    }, [appendErrorMessage, conversation?.id]),
    onStatusChange: setConnectionStatus,
  })

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

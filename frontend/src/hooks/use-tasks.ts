"use client"

import { useCallback, useEffect, useState } from "react"

import { requestData, websocketBaseUrl } from "@/lib/task-api"
import type {
  ConnectionStatus,
  TaskDetail,
  TaskListItem,
  TaskWorkspaceEvent,
  Workspace,
} from "@/types/task"

const reconnectDelayMs = 3000
const refreshDelayMs = 80

function useRequestRetry() {
  const [requestVersion, setRequestVersion] = useState(0)
  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1)
  }, [])
  return { requestVersion, retry }
}

export function useTasks() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [tasks, setTasks] = useState<TaskListItem[]>([])
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { requestVersion, retry } = useRequestRetry()

  useEffect(() => {
    const controller = new AbortController()

    async function loadTasks() {
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
        const workspaceTasks = await requestData<TaskListItem[]>(
          `/api/tasks?workspace_id=${currentWorkspace.id}`,
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) {
          setWorkspace(currentWorkspace)
          setTasks(workspaceTasks)
        }
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "任务列表加载失败。",
          )
          setConnectionStatus("offline")
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void loadTasks()
    return () => controller.abort()
  }, [requestVersion])

  useEffect(() => {
    if (!workspace) return

    const workspaceId = workspace.id
    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let shouldReconnect = true

    async function refreshTasks() {
      try {
        const workspaceTasks = await requestData<TaskListItem[]>(
          `/api/tasks?workspace_id=${workspaceId}`,
        )
        setTasks(workspaceTasks)
        setError(null)
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "任务列表实时刷新失败。",
        )
      }
    }

    function scheduleRefresh() {
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refreshTasks(), refreshDelayMs)
    }

    function connect() {
      setConnectionStatus("connecting")
      socket = new WebSocket(`${websocketBaseUrl}/ws/workspaces/${workspaceId}`)
      socket.onopen = () => setConnectionStatus("online")
      socket.onerror = () => setConnectionStatus("offline")
      socket.onclose = () => {
        setConnectionStatus("offline")
        if (shouldReconnect) {
          reconnectTimer = setTimeout(connect, reconnectDelayMs)
        }
      }
      socket.onmessage = (message) => {
        let event: TaskWorkspaceEvent
        try {
          event = JSON.parse(message.data) as TaskWorkspaceEvent
        } catch {
          setError("收到无法解析的任务实时消息。")
          return
        }

        if (event.type === "task.status_changed") {
          setTasks((current) =>
            current.map((task) =>
              task.id === event.payload.id
                ? { ...task, ...event.payload }
                : task,
            ),
          )
          scheduleRefresh()
        }

        if (event.type === "task.step_changed" || event.type === "model.call_finished") {
          scheduleRefresh()
        }

        if (event.type === "error") {
          setError(event.payload.message)
        }
      }
    }

    connect()
    return () => {
      shouldReconnect = false
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      socket?.close()
    }
  }, [workspace])

  return {
    workspace,
    tasks,
    connectionStatus,
    isLoading,
    error,
    retry,
  }
}

export function useTaskDetail(taskId: number) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { requestVersion, retry } = useRequestRetry()

  useEffect(() => {
    const controller = new AbortController()

    async function loadTask() {
      if (!Number.isInteger(taskId) || taskId <= 0) {
        setError("任务 ID 无效。")
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setError(null)
      try {
        const detail = await requestData<TaskDetail>(`/api/tasks/${taskId}`, {
          signal: controller.signal,
        })
        if (!controller.signal.aborted) setTask(detail)
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "任务详情加载失败。",
          )
          setConnectionStatus("offline")
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void loadTask()
    return () => controller.abort()
  }, [requestVersion, taskId])

  const workspaceId = task?.workspace_id ?? null

  useEffect(() => {
    if (workspaceId === null) return

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let shouldReconnect = true

    async function refreshTask() {
      try {
        const detail = await requestData<TaskDetail>(
          `/api/tasks/${taskId}`,
        )
        setTask(detail)
        setError(null)
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "任务详情实时刷新失败。",
        )
      }
    }

    function scheduleRefresh() {
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refreshTask(), refreshDelayMs)
    }

    function connect() {
      setConnectionStatus("connecting")
      socket = new WebSocket(`${websocketBaseUrl}/ws/workspaces/${workspaceId}`)
      socket.onopen = () => setConnectionStatus("online")
      socket.onerror = () => setConnectionStatus("offline")
      socket.onclose = () => {
        setConnectionStatus("offline")
        if (shouldReconnect) {
          reconnectTimer = setTimeout(connect, reconnectDelayMs)
        }
      }
      socket.onmessage = (message) => {
        let event: TaskWorkspaceEvent
        try {
          event = JSON.parse(message.data) as TaskWorkspaceEvent
        } catch {
          setError("收到无法解析的任务实时消息。")
          return
        }

        if (
          event.type === "task.status_changed" &&
          event.payload.id === taskId
        ) {
          setTask((current) =>
            current ? { ...current, ...event.payload } : current,
          )
          scheduleRefresh()
        }

        if (
          event.type === "task.step_changed" &&
          event.payload.task_id === taskId
        ) {
          scheduleRefresh()
        }

        if (
          event.type === "model.call_finished" &&
          event.payload.task_id === taskId
        ) {
          scheduleRefresh()
        }

        if (event.type === "error") setError(event.payload.message)
      }
    }

    connect()
    return () => {
      shouldReconnect = false
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      if (refreshTimer !== null) clearTimeout(refreshTimer)
      socket?.close()
    }
  }, [taskId, workspaceId])

  return {
    task,
    connectionStatus,
    isLoading,
    error,
    retry,
  }
}

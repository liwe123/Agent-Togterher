"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { requestData } from "@/lib/task-api"
import type {
  ConnectionStatus,
  TaskDetail,
  TaskListItem,
  TaskWorkspaceEvent,
  Workspace,
} from "@/types/task"
import { TASK_LIST_LIMIT, TASK_REFRESH_DELAY_MS } from "@/lib/constants"
import { shouldApplyTaskStatus } from "@/lib/task-utils"
import { useWorkspaceSocket } from "@/hooks/use-workspace-socket"
import {
  WORKSPACE_SWITCH_EVENT,
  pickActiveWorkspace,
  toWorkspace,
} from "@/lib/active-workspace"
import type { MyWorkspace } from "@/types/membership"

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
  const fetchedRef = useRef(false)

  // --- refresh timer management (kept in the hook) ---
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleWorkspaceSwitch = () => retry()
    window.addEventListener(WORKSPACE_SWITCH_EVENT, handleWorkspaceSwitch)
    return () =>
      window.removeEventListener(WORKSPACE_SWITCH_EVENT, handleWorkspaceSwitch)
  }, [retry])

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      if (workspace === null) return
      const workspaceId = workspace.id
      requestData<TaskListItem[]>(
        `/api/tasks?workspace_id=${workspaceId}&limit=${TASK_LIST_LIMIT}`,
      )
        .then((workspaceTasks) => {
          setTasks(workspaceTasks)
          setError(null)
        })
        .catch((requestError) => {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "任务列表实时刷新失败。",
          )
        })
    }, TASK_REFRESH_DELAY_MS)
  }, [workspace])

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    const controller = new AbortController()

    async function loadTasks() {
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
        const workspaceTasks = await requestData<TaskListItem[]>(
          `/api/tasks?workspace_id=${currentWorkspace.id}&limit=${TASK_LIST_LIMIT}`,
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

  useWorkspaceSocket({
    workspaceId: workspace?.id ?? null,
    onEvent: useCallback((event) => {
      const e = event as TaskWorkspaceEvent

      if (e.type === "task.status_changed") {
        setTasks((current) =>
          current.map((task) =>
            task.id === e.payload.id &&
            shouldApplyTaskStatus(task, e.payload)
              ? { ...task, ...e.payload }
              : task,
          ),
        )
        scheduleRefresh()
      }

      if (e.type === "task.step_changed" || e.type === "model.call_finished") {
        scheduleRefresh()
      }

      if (e.type === "error") {
        setError(e.payload.message)
      }
    }, [scheduleRefresh]),
    onStatusChange: setConnectionStatus,
  })

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

  const workspaceId = task?.workspace_id ?? null

  // --- refresh timer management (kept in the hook) ---
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => {
      if (workspaceId === null) return
      requestData<TaskDetail>(`/api/tasks/${taskId}`)
        .then((detail) => {
          setTask(detail)
          setError(null)
        })
        .catch((requestError) => {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "任务详情实时刷新失败。",
          )
        })
    }, TASK_REFRESH_DELAY_MS)
  }, [taskId, workspaceId])

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

  useWorkspaceSocket({
    workspaceId,
    onEvent: useCallback((event) => {
      const e = event as TaskWorkspaceEvent

      if (
        e.type === "task.status_changed" &&
        e.payload.id === taskId
      ) {
        setTask((current) =>
          current && shouldApplyTaskStatus(current, e.payload)
            ? { ...current, ...e.payload }
            : current,
        )
        scheduleRefresh()
      }

      if (
        e.type === "task.step_changed" &&
        e.payload.task_id === taskId
      ) {
        scheduleRefresh()
      }

      if (
        e.type === "model.call_finished" &&
        e.payload.task_id === taskId
      ) {
        scheduleRefresh()
      }

      if (e.type === "error") setError(e.payload.message)
    }, [scheduleRefresh, taskId]),
    onStatusChange: setConnectionStatus,
  })

  return {
    task,
    connectionStatus,
    isLoading,
    error,
    retry,
  }
}

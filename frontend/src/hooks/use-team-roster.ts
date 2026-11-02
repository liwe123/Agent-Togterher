"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { WORKSPACE_SWITCH_EVENT, pickActiveWorkspace } from "@/lib/active-workspace"
import { requestData } from "@/lib/task-api"
import type { Agent } from "@/types/agent"
import type { MyWorkspace } from "@/types/membership"

interface UseTeamRosterOptions {
  /** 已由上层确定工作区时直接传入，避免重复请求 /workspaces/my */
  workspaceId?: number | null
  /** 惰性加载开关（如命令面板仅在打开时拉取） */
  enabled?: boolean
}

/**
 * 团队列 / 命令面板共用的 Agent 名单数据源。
 * 优先使用上层传入的 workspaceId；缺省时复用 useAgentConsole 的
 * /api/v1/workspaces/my + /api/agents?workspace_id= 拉取链路。
 */
export function useTeamRoster({
  workspaceId = null,
  enabled = true,
}: UseTeamRosterOptions = {}) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<number | null>(
    workspaceId,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const fetchedKeyRef = useRef<string | null>(null)

  const retry = useCallback(() => {
    fetchedKeyRef.current = null
    setRequestVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    const handleWorkspaceSwitch = () => retry()
    window.addEventListener(WORKSPACE_SWITCH_EVENT, handleWorkspaceSwitch)
    return () =>
      window.removeEventListener(WORKSPACE_SWITCH_EVENT, handleWorkspaceSwitch)
  }, [retry])

  useEffect(() => {
    if (!enabled) return
    const key = `${workspaceId ?? "auto"}:${requestVersion}`
    if (fetchedKeyRef.current === key) return
    fetchedKeyRef.current = key

    const controller = new AbortController()
    let cancelled = false
    let loaded = false

    async function loadRoster() {
      setIsLoading(true)
      setError(null)
      try {
        let targetWorkspaceId = workspaceId
        if (targetWorkspaceId === null) {
          const myWorkspaces = await requestData<MyWorkspace[]>(
            "/api/v1/workspaces/my",
            { signal: controller.signal },
          )
          const active = pickActiveWorkspace(myWorkspaces)
          if (!active) {
            throw new Error("没有可用工作区，请先启动后端完成默认数据初始化。")
          }
          targetWorkspaceId = active.id
        }
        const agentsData = await requestData<Agent[]>(
          `/api/agents?workspace_id=${targetWorkspaceId}`,
          { signal: controller.signal },
        )
        if (cancelled) return
        loaded = true
        setResolvedWorkspaceId(targetWorkspaceId)
        setAgents(agentsData)
      } catch (requestError) {
        if (!cancelled && (requestError as Error).name !== "AbortError") {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "无法连接 Agent API，请确认后端已在 8000 端口启动。",
          )
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadRoster()
    return () => {
      cancelled = true
      controller.abort()
      // 未完成即被中止（如命令面板关闭）时释放缓存键，下次启用可重新拉取
      if (!loaded) fetchedKeyRef.current = null
    }
  }, [enabled, workspaceId, requestVersion])

  return {
    agents,
    workspaceId: resolvedWorkspaceId,
    isLoading,
    error,
    retry,
  }
}

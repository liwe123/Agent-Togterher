"use client"

import { useState } from "react"
import { Activity } from "@/components/ui/icons"

import { AppSidebar } from "@/components/console/app-sidebar"
import { AgentGallery } from "@/components/console/agent-gallery"
import { DetailsPanel } from "@/components/console/details-panel"
import { SoftwareDock } from "@/components/console/software-dock"
import { StatusPanel } from "@/components/console/status-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import { Badge } from "@/components/ui/badge"
import { useAgentConsole } from "@/hooks/use-agent-console"
import type { Agent } from "@/types/agent"

const connectionLabels = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接断开",
}

export function AgentConsole() {
  const {
    agents,
    recentOutputs,
    connectionStatus,
    isLoading,
    error,
    retry,
    workspaceName,
  } = useAgentConsole()

  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(true)

  const runningCount = agents.filter((a) => a.status === "running").length
  const selectedAgent =
    selectedAgentId === null
      ? null
      : agents.find((agent) => agent.id === selectedAgentId) ?? null

  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgentId(agent.id)
    setIsDetailOpen(true)
  }

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-clip md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto]">
      <AppSidebar
        connectionStatus={connectionStatus}
        agents={agents}
        agentsLoading={isLoading}
        agentsError={error}
        onRetryAgents={retry}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
      />

      <ErrorBoundary>
        <main className="console-main min-w-0 px-4 py-5 sm:px-6 md:px-7 md:py-6 xl:px-8">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6">
            {/* At-A-Glance：发丝线卡片，替代 border-b + backdrop-blur 条 */}
            <div className="console-card hidden items-center justify-between gap-4 px-5 py-3.5 md:flex">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-console-raised text-console-accent">
                  <Activity aria-hidden="true" className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold leading-[18px] text-console-ink">
                    集群控制台
                  </span>
                  <span className="console-meta truncate">
                    {agents.length} 位 Agent · {runningCount} 位正在处理任务
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="console-pill inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[12px] text-console-ink-2">
                  <span className="size-1.5 rounded-full bg-console-accent" aria-hidden="true" />
                  {workspaceName ?? "默认工作区"}
                </span>
                <span className="console-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-console-ink-2">
                  <span
                    className="status-dot size-2 rounded-full"
                    data-status={connectionStatus}
                    aria-hidden="true"
                  />
                  {connectionLabels[connectionStatus]}
                </span>
              </div>
            </div>

            {/* Header with greeting & metrics */}
            <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <h1 className="text-[1.85rem] font-bold tracking-[-0.03em] text-console-ink">集群总览</h1>
                <p className="text-sm text-console-ink-2">Agent 投递链路、软件端口与运行状态监控</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="console-pill flex items-center gap-2.5 px-4 py-2 text-xs">
                  <span className="text-console-ink-3">成员:</span>
                  <span className="console-tabular font-mono font-semibold text-console-ink">{agents.length}</span>
                  <span className="text-console-ink-3">·</span>
                  <span className="font-semibold text-console-accent">{runningCount} 运行中</span>
                </div>
                <Badge className="connection-chip md:hidden" variant={connectionStatus === "offline" ? "destructive" : "outline"}>
                  <span
                    className="status-dot size-1.5 rounded-full"
                    data-status={connectionStatus}
                    aria-hidden="true"
                  />
                  {connectionLabels[connectionStatus]}
                </Badge>
              </div>
            </header>

            <SoftwareDock />

            <AgentGallery
              agents={agents}
              isLoading={isLoading}
              error={error}
              onRetry={retry}
            />

            <StatusPanel agents={agents} recentOutputs={recentOutputs} />
          </div>
        </main>
      </ErrorBoundary>

      <DetailsPanel
        agent={selectedAgent}
        open={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />
    </div>
  )
}

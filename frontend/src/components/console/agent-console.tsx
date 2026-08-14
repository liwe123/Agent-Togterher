"use client"

import { AppSidebar } from "@/components/console/app-sidebar"
import { AgentGallery } from "@/components/console/agent-gallery"
import { SoftwareDock } from "@/components/console/software-dock"
import { StatusPanel } from "@/components/console/status-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import { Badge } from "@/components/ui/badge"
import { useAgentConsole } from "@/hooks/use-agent-console"

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
  } = useAgentConsole()

  const runningCount = agents.filter((a) => a.status === "running").length

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} />

      <ErrorBoundary>
        <main className="console-main px-4 py-5 sm:px-6 md:px-0 md:py-0">
          {/* Top M3 At-A-Glance Bar */}
          <div className="hidden h-[72px] items-center justify-between border-b border-border/70 bg-card/60 backdrop-blur-xl px-7 md:flex">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-border/80 bg-secondary/60 px-3.5 py-1.5 shadow-sm">
                <span className="size-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-semibold tracking-tight text-foreground">集群控制台</span>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1 font-mono text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary" />
                DEFAULT WORKSPACE
              </span>
              <div className="h-4 w-px bg-border/80" />
              <span className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/40 px-3 py-1 font-medium text-foreground">
                <span className="status-dot size-2 rounded-full" data-status={connectionStatus} aria-hidden="true" />
                {connectionLabels[connectionStatus]}
              </span>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 md:px-7 md:py-7 xl:px-9">
            {/* Header with Pixel greeting & metrics */}
            <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <h1 className="text-[1.85rem] font-bold tracking-[-0.03em] text-foreground">集群总览</h1>
                <p className="text-sm text-muted-foreground">Agent 投递链路、软件端口与运行状态监控</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2.5 rounded-full border border-border/80 bg-card/90 px-4 py-2 text-xs shadow-sm">
                  <span className="text-muted-foreground">成员:</span>
                  <span className="font-mono font-semibold text-foreground">{agents.length}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-semibold text-primary">{runningCount} 运行中</span>
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
    </div>
  )
}

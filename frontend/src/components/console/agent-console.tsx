"use client"

import { AppSidebar } from "@/components/console/app-sidebar"
import { AgentGallery } from "@/components/console/agent-gallery"
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

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[232px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} />

      <ErrorBoundary>
        <main className="console-main px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
          <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-8">
            <header className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em]">运行总览</h1>
                <p className="text-sm text-muted-foreground">查看 Agent 负载、模型绑定与最近输出</p>
              </div>
              <Badge className="connection-chip" variant={connectionStatus === "offline" ? "destructive" : "outline"}>
                <span
                  className="status-dot size-1.5 rounded-full"
                  data-status={connectionStatus}
                  aria-hidden="true"
                />
                {connectionLabels[connectionStatus]}
              </Badge>
            </header>

            <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_284px]">
              <AgentGallery
                agents={agents}
                isLoading={isLoading}
                error={error}
                onRetry={retry}
              />
              <StatusPanel agents={agents} recentOutputs={recentOutputs} />
            </div>
          </div>
        </main>
      </ErrorBoundary>
    </div>
  )
}

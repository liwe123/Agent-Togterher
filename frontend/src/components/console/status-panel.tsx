import { Activity, Bot, Clock3 } from "lucide-react"

import type { Agent, RecentOutput } from "@/types/agent"

function formatRelativeTime(value: string | null) {
  if (value === null) return "暂无"
  const diff = Date.now() - new Date(value).getTime()
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value))
}

interface StatusPanelProps {
  agents: Agent[]
  recentOutputs: RecentOutput[]
}

export function StatusPanel({ agents, recentOutputs }: StatusPanelProps) {
  const running = agents.filter((agent) => agent.status === "running").length
  const failed = agents.filter((agent) => agent.status === "failed").length
  const idle = agents.length - running - failed
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const totalAgents = Math.max(agents.length, 1)
  const runningPercent = Math.round((running / totalAgents) * 100)
  const failedPercent = Math.round((failed / totalAgents) * 100)
  const idlePercent = 100 - runningPercent - failedPercent

  return (
    <section aria-labelledby="agent-status" className="console-panel overflow-hidden rounded-2xl border border-border bg-card/82 p-4 sm:p-5">
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
                <Activity aria-hidden="true" className="size-4" />
              </span>
              <div>
                <h2 id="agent-status" className="text-base font-semibold">Agent 负载与运行状态</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">实时集群资源分布</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-primary font-semibold">{running} 工作中</span> · {idle} 空闲 · 共 {agents.length} 人
            </p>
          </div>

          {/* Progress bar breakdown */}
          <div className="mb-5 space-y-1.5">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
              {running > 0 && (
                <div
                  style={{ width: `${runningPercent}%` }}
                  className="bg-[var(--status-running)] transition-all duration-500"
                  title={`工作中: ${running} (${runningPercent}%)`}
                />
              )}
              {failed > 0 && (
                <div
                  style={{ width: `${failedPercent}%` }}
                  className="bg-[var(--status-failed)] transition-all duration-500"
                  title={`异常: ${failed} (${failedPercent}%)`}
                />
              )}
              {idle > 0 && (
                <div
                  style={{ width: `${idlePercent}%` }}
                  className="bg-[var(--status-idle)]/40 transition-all duration-500"
                  title={`空闲: ${idle} (${idlePercent}%)`}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-[var(--status-running)]" /> 工作中 ({runningPercent}%)
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-[var(--status-idle)]/50" /> 空闲 ({idlePercent}%)
              </span>
              {failed > 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <span className="size-1.5 rounded-full bg-[var(--status-failed)]" /> 异常 ({failedPercent}%)
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex min-w-0 items-center gap-2 rounded-full border border-border/80 bg-background/50 px-3 py-1.5 shadow-sm transition-all hover:border-primary/40 hover:bg-card"
              >
                <span aria-hidden="true" className="text-base select-none">{agent.avatar ?? "🤖"}</span>
                <span className="max-w-36 truncate text-xs font-medium">{agent.name}</span>
                <span className="status-dot size-2 rounded-full" data-status={agent.status} aria-hidden="true" />
                <span className="text-[10px] text-muted-foreground">
                  {agent.status === "running" ? "工作中" : agent.status === "failed" ? "异常" : "空闲"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
          <div className="mb-3 flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-2">
              <Clock3 aria-hidden="true" className="size-3.5 text-primary" />
              最近 Agent 输出
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">{recentOutputs.length} 条记录</span>
          </div>

          {recentOutputs.length > 0 ? (
            <div className="space-y-3 max-h-56 overflow-y-auto scrollbar-thin pr-1">
              {recentOutputs.slice(0, 3).map((output, idx) => {
                const agent = agentsById.get(output.agentId)
                return (
                  <div key={idx} className="flex gap-3 rounded-xl border border-border/60 bg-muted/30 p-2.5 transition-colors hover:bg-muted/60">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-base" aria-hidden="true">
                      {agent?.avatar ?? "🤖"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold">{agent?.name ?? "Agent"}</p>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatRelativeTime(output.createdAt)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{output.content}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-muted-foreground rounded-xl border border-dashed border-border p-4">
              <Bot aria-hidden="true" className="size-4" />
              等待新的 Agent 实时输出
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

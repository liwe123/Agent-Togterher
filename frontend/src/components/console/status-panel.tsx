import { Clock3, FileOutput, Radio } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { Agent, RecentOutput } from "@/types/agent"

function formatRelativeTime(value: string | null) {
  if (value === null) return "暂无"
  const diff = Date.now() - new Date(value).getTime()
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value))
}

function shortContent(content: string) {
  return content.replace(/\s+/g, " ").slice(0, 54)
}

interface StatusPanelProps {
  agents: Agent[]
  recentOutputs: RecentOutput[]
}

export function StatusPanel({ agents, recentOutputs }: StatusPanelProps) {
  const counts = agents.reduce(
    (result, agent) => {
      if (agent.status === "running") result.running += 1
      else if (agent.status === "failed") result.failed += 1
      else result.idle += 1
      return result
    },
    { running: 0, idle: 0, failed: 0 },
  )

  const recentAgents = agents
    .filter((agent) => agent.last_active_at !== null)
    .toSorted((a, b) =>
      (b.last_active_at ?? "").localeCompare(a.last_active_at ?? ""),
    )
    .slice(0, 4)

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))

  return (
    <aside aria-label="Agent 状态" className="console-panel min-w-0 overflow-hidden rounded-xl border border-border bg-card/70">
      <section className="p-4">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Radio aria-hidden="true" className="size-4 text-primary" />
          编队状态
        </h2>
        <div className="flex flex-col gap-3">
          <StatusRow label="工作中" value={counts.running} status="running" />
          <StatusRow label="空闲" value={counts.idle} status="idle" />
          <StatusRow label="失败" value={counts.failed} status="failed" />
          <Separator />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Agent 总数</span>
            <span className="font-mono font-medium">{agents.length}</span>
          </div>
        </div>
      </section>

      <section className="border-t border-border p-4">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Clock3 aria-hidden="true" className="size-4 text-primary" />
          最近活跃
        </h2>
        <div className="flex flex-col gap-3">
          {recentAgents.length > 0 ? (
            recentAgents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3">
                <Avatar size="sm">
                  <AvatarFallback>{agent.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{agent.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(agent.last_active_at)}
                  </p>
                </div>
                <Badge variant={agent.status === "failed" ? "destructive" : "secondary"}>
                  {agent.status === "running" ? "工作中" : agent.status === "failed" ? "失败" : "空闲"}
                </Badge>
              </div>
            ))
          ) : (
            <p className="py-2 text-xs leading-5 text-muted-foreground">
              Agent 开始执行任务后，这里会显示最近活跃记录。
            </p>
          )}
        </div>
      </section>

      <section className="border-t border-border p-4">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <FileOutput aria-hidden="true" className="size-4 text-primary" />
          最近输出
        </h2>
        <div className="flex flex-col gap-3">
          {recentOutputs.length > 0 ? (
            recentOutputs.map((output) => {
              const agent = agentsById.get(output.agentId)
              return (
                <div key={output.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {agent?.name ?? "Agent"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(output.createdAt)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {shortContent(output.content)}
                  </p>
                </div>
              )
            })
          ) : (
            <p className="py-2 text-xs leading-5 text-muted-foreground">
              新的群聊结果会通过实时通道到达这里。
            </p>
          )}
        </div>
      </section>
    </aside>
  )
}

interface StatusRowProps {
  label: string
  value: number
  status: "running" | "idle" | "failed"
}

function StatusRow({ label, value, status }: StatusRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="status-dot size-2 rounded-full" data-status={status} aria-hidden="true" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-medium">{value}</span>
    </div>
  )
}

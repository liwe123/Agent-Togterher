import { AlertCircle } from "lucide-react"

import { AgentCard } from "@/components/console/agent-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Agent } from "@/types/agent"

interface AgentGalleryProps {
  agents: Agent[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}

export function AgentGallery({
  agents,
  isLoading,
  error,
  onRetry,
}: AgentGalleryProps) {
  return (
    <section aria-labelledby="agent-gallery" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="agent-gallery" className="text-base font-semibold tracking-tight">
            Agent 编队
          </h2>
          <p className="text-xs text-muted-foreground">成员状态、职责和模型绑定</p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {agents.length.toString().padStart(2, "0")} Agents
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index} className="min-h-56">
              <CardHeader className="flex-row items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-px w-full" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="size-4 text-destructive" />
              Agent 数据加载失败
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={onRetry}>重新连接</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
          {agents.map((agent, index) => (
            <AgentCard key={agent.id} agent={agent} index={index} />
          ))}
        </div>
      )}
    </section>
  )
}

"use client"

import { AlertCircle, Bot, Cpu, MessageSquare, UsersRound, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { AgentPortrait } from "@/components/console/agent-portrait"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

const roleLabels: Record<string, string> = {
  project_architect: "项目总设计师",
  agent_engineer: "Agent 工程师",
  frontend_designer: "前端/视觉设计",
  knowledge_manager: "知识库管理",
  qa_engineer: "测试与验收",
  operations_engineer: "运行与部署",
}

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
  const [selectedAgent, setSelectedAgent] = useState<{ agent: Agent; index: number } | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)
  const running = agents.filter((agent) => agent.status === "running").length
  const failed = agents.filter((agent) => agent.status === "failed").length

  function selectAgent(agent: Agent, index: number) {
    lastTriggerRef.current = document.activeElement as HTMLElement | null
    setSelectedAgent({ agent, index })
  }

  function closeAgent() {
    setSelectedAgent(null)
    requestAnimationFrame(() => lastTriggerRef.current?.focus())
  }

  useEffect(() => {
    if (!selectedAgent) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeAgent()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [selectedAgent])

  return (
    <>
      <section aria-labelledby="agent-gallery" className="console-panel overflow-hidden rounded-2xl border border-border bg-card/82 p-4 sm:p-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
              <UsersRound aria-hidden="true" className="size-4" />
            </span>
            <div>
              <h2 id="agent-gallery" className="text-base font-semibold tracking-tight">Agent 群像</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">点击 Agent 肖像查看角色详情与绑定模型</p>
            </div>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            <span className="text-primary font-medium">{running} 工作中</span>
            <span aria-hidden="true"> · </span>
            {failed > 0 ? <span className="text-destructive font-medium">{failed} 异常 · </span> : ""}共 {agents.length} 人
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-3 gap-5 sm:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex flex-col items-center gap-2">
                <Skeleton className="size-[76px] rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle aria-hidden="true" className="size-5 text-destructive" />
            <div>
              <p className="text-sm font-semibold">Agent 数据加载失败</p>
              <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            </div>
            <Button variant="outline" onClick={onRetry}>重新连接</Button>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Bot aria-hidden="true" className="size-6" />
            <p className="text-sm">暂无 Agent，启动后端后会自动载入默认成员。</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <RosterGroup
              label="TRAE Work"
              agents={agents.slice(0, 4)}
              startIndex={0}
              onSelectAgent={selectAgent}
            />
            {agents.length > 4 ? (
              <RosterGroup
                label="Sylway 服务"
                agents={agents.slice(4)}
                startIndex={4}
                onSelectAgent={(agent, index) => setSelectedAgent({ agent, index })}
              />
            ) : null}
          </div>
        )}
      </section>

      {selectedAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAgent()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-detail-title"
            aria-describedby="agent-detail-description"
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-2xl"
          >
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="关闭 Agent 详情"
              onClick={closeAgent}
              className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>

            <div className="flex flex-col items-center text-center">
              <AgentPortrait agent={selectedAgent.agent} index={selectedAgent.index} size="lg" />
              <h3 id="agent-detail-title" className="mt-4 text-xl font-bold">{selectedAgent.agent.name}</h3>
              <Badge variant="outline" className="mt-1 border-primary/40 text-primary">
                {roleLabels[selectedAgent.agent.role] ?? selectedAgent.agent.role}
              </Badge>
              <p id="agent-detail-description" className="mt-3 text-sm leading-6 text-muted-foreground">
                {selectedAgent.agent.description || "暂无描述"}
              </p>

              <div className="mt-5 w-full space-y-3 rounded-xl border border-border/80 bg-muted/40 p-3.5 text-left text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="status-dot size-2 rounded-full" data-status={selectedAgent.agent.status} />
                    {selectedAgent.agent.status === "running" ? "工作中" : selectedAgent.agent.status === "failed" ? "异常" : "空闲"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Cpu className="size-3.5" />
                    绑定模型
                  </span>
                  <span className="font-mono text-foreground font-semibold">{selectedAgent.agent.model_name}</span>
                </div>
              </div>

              <div className="mt-6 flex w-full gap-3">
                <Button variant="outline" className="flex-1" onClick={closeAgent}>
                  关闭
                </Button>
                <Link
                  href={`/chats?mention=${encodeURIComponent(selectedAgent.agent.name)}`}
                  className={cn(buttonVariants({ variant: "default" }), "flex-1")}
                >
                  <MessageSquare className="mr-1.5 size-4" />
                  去群聊提及
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function RosterGroup({
  label,
  agents,
  startIndex,
  onSelectAgent,
}: {
  label: string
  agents: Agent[]
  startIndex: number
  onSelectAgent: (agent: Agent, index: number) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="flex items-center gap-2 font-medium text-foreground/85">
          <Bot aria-hidden="true" className="size-3.5" />
          {label}
        </span>
        <span className="text-muted-foreground">{agents.length} 人</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
        {agents.map((agent, localIndex) => {
          const index = startIndex + localIndex
          return (
            <button
              key={agent.id}
              type="button"
              className="group flex min-w-0 flex-col items-center rounded-xl p-2 text-center transition-colors hover:bg-muted/35 focus-visible:bg-muted/35"
              aria-label={`查看 ${agent.name} 的详情`}
              onClick={() => onSelectAgent(agent, index)}
            >
              <AgentPortrait agent={agent} index={index} />
              <span className="mt-2.5 w-full truncate text-xs font-semibold transition-colors group-hover:text-primary" title={agent.name}>
                {agent.name}
              </span>
              <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">
                {agent.status === "running" ? "工作中" : agent.status === "failed" ? "需要处理" : "小憩中"}
              </span>
              <span className="mt-1 hidden w-full truncate text-[11px] text-primary/85 group-hover:block md:block">
                {roleLabels[agent.role] ?? agent.role}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

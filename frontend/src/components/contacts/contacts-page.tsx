"use client"

import { AlertCircle, ContactRound, Cpu, MessageSquare, Search } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { AgentPortrait } from "@/components/console/agent-portrait"
import { AppSidebar } from "@/components/console/app-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAgentConsole } from "@/hooks/use-agent-console"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

const roleLabels: Record<string, string> = {
  project_architect: "项目总设计师",
  agent_engineer: "Agent 工程师",
  frontend_designer: "前端/视觉设计师",
  knowledge_manager: "知识库管理员",
  qa_engineer: "测试专员",
  operations_engineer: "运维",
}

const roleDescriptions: Record<string, string> = {
  project_architect: "任务拆解、系统方案与最终结果整合",
  agent_engineer: "Agent 编排、工具调用与后端实现",
  frontend_designer: "界面架构、交互设计与视觉实现",
  knowledge_manager: "知识整理、检索维护与信息溯源",
  qa_engineer: "自动化测试、集成验证与质量把关",
  operations_engineer: "基础设施、端口管理、部署与监控",
}

export function ContactsPage() {
  const { agents, connectionStatus, isLoading, error, retry } = useAgentConsole()
  const [searchQuery, setSearchQuery] = useState("")

  const filteredAgents = agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (roleLabels[agent.role] ?? agent.role).toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="contacts" />

      <main className="console-main px-5 py-7 sm:px-7 md:px-9 md:py-8 xl:px-12">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-7">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-[-0.03em] md:text-[1.75rem]">通讯录</h1>
              <p className="mt-1 text-sm text-muted-foreground">工作区 Agent 实名目录与服务归属</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge className="connection-chip" variant={connectionStatus === "offline" ? "destructive" : "outline"}>
                <span className="status-dot size-1.5 rounded-full" data-status={connectionStatus} aria-hidden="true" />
                {agents.length} 人在线
              </Badge>
            </div>
          </header>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Agent 姓名或角色职责…"
              className="h-11 w-full rounded-xl border border-input bg-card/80 pl-10 pr-4 text-sm shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-5">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex items-center gap-4">
                  <Skeleton className="size-14 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-card p-6 text-center">
              <AlertCircle aria-hidden="true" className="size-6 text-destructive" />
              <div>
                <h2 className="font-semibold">无法加载通讯录</h2>
                <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              </div>
              <Button variant="outline" onClick={retry}>重新连接</Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card/75 p-4 sm:p-6 shadow-md">
              <ContactGroup label="TRAE Work CN" agents={filteredAgents.slice(0, 5)} startIndex={0} />
              {filteredAgents.length > 5 ? (
                <div className="mt-8 border-t border-border pt-8">
                  <ContactGroup label="Sylway 服务" agents={filteredAgents.slice(5)} startIndex={5} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function ContactGroup({ label, agents, startIndex }: { label: string; agents: Agent[]; startIndex: number }) {
  return (
    <section aria-labelledby={`contact-${startIndex}`}>
      <div className="mb-5 flex items-center justify-between gap-4 text-muted-foreground">
        <h2 id={`contact-${startIndex}`} className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground">
          <ContactRound aria-hidden="true" className="size-4 text-primary" />
          {label}
        </h2>
        <span className="font-mono text-xs text-muted-foreground">{agents.length} 人</span>
      </div>
      <div className="flex flex-col gap-4">
        {agents.map((agent, localIndex) => (
          <article
            key={agent.id}
            className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 transition-all hover:border-primary/40 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4"
          >
            <AgentPortrait agent={agent} index={startIndex + localIndex} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-bold text-foreground">{agent.name}</h3>
                <Badge variant="outline" className="border-primary/30 text-primary text-[11px]">
                  {roleLabels[agent.role] ?? agent.role}
                </Badge>
                {agent.role === "project_architect" || agent.role === "operations_engineer" ? (
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 md:text-emerald-300 text-[10px]" variant="outline">
                    管理员
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {roleDescriptions[agent.role] ?? agent.description}
              </p>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Cpu className="size-3 text-muted-foreground" />
                <span className="font-mono">{agent.model_name}</span>
              </div>
            </div>

            <Link
              href={`/chats?mention=${encodeURIComponent(agent.name)}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors")}
            >
              <MessageSquare className="mr-1.5 size-3.5" />
              发起对话
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}

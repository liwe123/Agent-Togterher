import { Activity, Circle, Cpu } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { Agent } from "@/types/agent"

const roleLabels: Record<string, string> = {
  project_architect: "系统架构与方案设计",
  agent_engineer: "Agent 编排与后端实现",
  frontend_designer: "界面设计与交互实现",
  knowledge_manager: "知识管理与检索维护",
  qa_engineer: "测试执行与质量保障",
  operations_engineer: "系统运维与监控保障",
}

const statusLabels: Record<string, string> = {
  running: "工作中",
  idle: "空闲",
  failed: "失败",
}

const initials: Record<string, string> = {
  项目总设计师: "PD",
  Agent工程师: "AE",
  前端设计师: "FD",
  知识库管理员: "KM",
  测试专员: "QA",
  运维: "OP",
}

interface AgentCardProps {
  agent: Agent
  index: number
}

export function AgentCard({ agent, index }: AgentCardProps) {
  const status = statusLabels[agent.status] ?? agent.status
  const badgeVariant =
    agent.status === "failed"
      ? "destructive"
      : agent.status === "running"
        ? "default"
        : "secondary"

  return (
    <Card className="agent-card min-h-56" data-agent-status={agent.status}>
      <CardHeader className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
        <Avatar className="agent-avatar size-12" data-tone={index % 6}>
          <AvatarFallback>{initials[agent.name] ?? agent.name.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <CardTitle className="truncate">{agent.name}</CardTitle>
          <CardDescription className="truncate">
            {roleLabels[agent.role] ?? agent.role}
          </CardDescription>
        </div>
        <span className="self-start font-mono text-[10px] text-muted-foreground">
          A-{String(index + 1).padStart(2, "0")}
        </span>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
          {agent.description}
        </p>

        <div className="flex items-center justify-between gap-3">
          <Badge variant={badgeVariant}>
            {agent.status === "running" ? (
              <Activity data-icon="inline-start" />
            ) : (
              <Circle data-icon="inline-start" fill="currentColor" />
            )}
            {status}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {agent.last_active_at ? "已同步" : "等待任务"}
          </span>
        </div>

        <Separator className="opacity-80" />

        <div className="mt-auto flex items-center gap-2 text-xs">
          <Cpu aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">绑定模型</span>
          <span className="ml-auto max-w-40 truncate font-mono text-foreground/85">
            {agent.model_name}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

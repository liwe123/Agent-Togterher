import { AlertTriangle, Bot, UserRound } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"
import type { ChatMessage, ChatTask } from "@/types/chat"

const taskStatusLabels: Record<string, string> = {
  pending: "等待处理",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
}

const agentInitials: Record<string, string> = {
  项目总设计师: "PD",
  Agent工程师: "AE",
  前端设计师: "FD",
  知识库管理员: "KM",
  测试专员: "QA",
  运维: "OP",
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

interface MessageBubbleProps {
  message: ChatMessage
  agent?: Agent
  agentIndex?: number
  task?: ChatTask
}

export function MessageBubble({
  message,
  agent,
  agentIndex = 0,
  task,
}: MessageBubbleProps) {
  const isUser = message.sender_type === "user"
  const isSystem = message.sender_type === "system"
  const isError = message.message_type === "error"
  const senderName = isUser ? "你" : isSystem ? "系统" : agent?.name ?? "Agent"
  const taskLabel = task
    ? taskStatusLabels[task.status] ?? task.status
    : message.message_type === "task"
      ? "任务消息"
      : null
  const taskBadgeVariant =
    task?.status === "failed"
      ? "destructive"
      : task?.status === "running"
        ? "default"
        : task?.status === "completed"
          ? "secondary"
          : "outline"

  if (isSystem && !isError) {
    return (
      <article className="flex justify-center px-2 py-1">
        <div className="flex max-w-[88%] items-center gap-2 rounded-full border border-border/70 bg-muted/55 px-3 py-1.5 text-xs text-muted-foreground">
          <Avatar size="sm">
            <AvatarFallback>
              <Bot aria-hidden="true" className="size-3" />
            </AvatarFallback>
          </Avatar>
          <span className="whitespace-pre-wrap break-words">{message.content}</span>
          <time className="shrink-0 font-mono text-[10px]" dateTime={message.created_at}>
            {formatTime(message.created_at)}
          </time>
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        "flex w-full items-end gap-2.5",
        isUser ? "justify-end" : "justify-start",
      )}
      data-message-type={message.message_type}
    >
      {!isUser && (
        <Avatar className="agent-avatar size-9" data-tone={agentIndex % 6}>
          <AvatarFallback>
            {agent?.avatar ??
              agentInitials[agent?.name ?? ""] ?? (
                <Bot aria-hidden="true" className="size-4" />
              )}
          </AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "flex max-w-[min(82%,46rem)] flex-col gap-1.5 rounded-xl border px-3.5 py-2.5 sm:px-4 sm:py-3",
          isUser
            ? "rounded-br-sm border-primary/40 bg-primary/12 text-foreground"
            : "rounded-bl-md border-border bg-card text-card-foreground",
          isError &&
            "border-destructive/45 bg-destructive/10 text-foreground",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isError && (
            <AlertTriangle
              aria-hidden="true"
              className="size-3.5 shrink-0 text-destructive"
            />
          )}
          <span
            className={cn(
              "truncate text-xs font-semibold",
              isUser ? "text-primary" : "text-foreground",
              isError && "text-destructive",
            )}
          >
            {senderName}
          </span>
          {taskLabel && (
            <Badge
              variant={taskBadgeVariant}
              className={cn(
                "h-4 px-1.5 text-[10px]",
                isUser &&
                  task?.status !== "failed" &&
                  "border-primary/30 bg-primary/10 text-primary",
              )}
            >
              {taskLabel}
            </Badge>
          )}
        </div>

        <p className="whitespace-pre-wrap break-words text-sm leading-6">
          {message.content}
        </p>

        <time
          className="self-end font-mono text-[10px] text-muted-foreground"
          dateTime={message.created_at}
        >
          {formatTime(message.created_at)}
        </time>
      </div>

      {isUser && (
        <Avatar className="size-9">
          <AvatarFallback className="bg-primary/18 text-primary">
            <UserRound aria-hidden="true" className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </article>
  )
}

import { AlertTriangle, Bot, ExternalLink, UserRound } from "lucide-react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"
import type { ChatMessage, ChatTask } from "@/types/chat"

const taskStatusLabels: Record<string, string> = {
  pending: "等待处理",
  running: "进行中",
  waiting_approval: "等待审批",
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

function MessageContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.startsWith("language-")
          return isBlock ? (
            <code className={cn("block overflow-x-auto rounded-2xl bg-secondary/80 p-3.5 font-mono text-xs leading-6 border border-border/60", className)}>
              {children}
            </code>
          ) : (
            <code className="rounded-md bg-secondary/80 px-1.5 py-0.5 font-mono text-[0.88em] text-primary font-medium">
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className="my-3 overflow-x-auto">{children}</pre>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-bold tracking-tight text-foreground">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-bold tracking-tight text-foreground">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1.5 mt-2 font-semibold text-foreground">{children}</h3>,
        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
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
      <article className="flex justify-center px-2 py-1.5">
        <div className="flex max-w-[88%] items-center gap-2 rounded-full border border-border/60 bg-secondary/50 px-4 py-1.5 text-xs text-muted-foreground shadow-sm">
          <Avatar size="sm">
            <AvatarFallback className="rounded-full bg-secondary text-primary">
              <Bot aria-hidden="true" className="size-3.5" />
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
        "flex w-full items-start gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
      data-message-type={message.message_type}
    >
      {!isUser && (
        <Avatar className="agent-avatar size-9.5 shadow-sm rounded-full ring-2 ring-card" data-tone={agentIndex % 6}>
          <AvatarFallback className="rounded-full">
            {agent?.avatar ??
              agentInitials[agent?.name ?? ""] ?? (
                <Bot aria-hidden="true" className="size-4" />
              )}
          </AvatarFallback>
        </Avatar>
      )}

      <div className={cn("flex max-w-[min(84%,48rem)] flex-col", isUser ? "items-end" : "items-start")}>
        <div className="mb-1.5 flex min-w-0 items-center gap-2 px-1">
          {isError && (
            <AlertTriangle
              aria-hidden="true"
              className="size-3.5 shrink-0 text-destructive"
            />
          )}
          <span
            className={cn(
              "truncate text-xs font-semibold",
              isUser ? "text-primary font-bold" : "text-foreground",
              isError && "text-destructive",
            )}
          >
            {senderName}
          </span>
          {taskLabel && (
            task ? (
              <Link
                href={`/tasks/${task.id}`}
                title={`查看 Task #${task.id} 详情`}
                className="group flex items-center gap-1 transition-opacity hover:opacity-85"
              >
                <Badge
                  variant={taskBadgeVariant}
                  className={cn(
                    "h-5 rounded-full px-2 text-[10px] gap-1 cursor-pointer shadow-sm",
                    isUser &&
                      task?.status !== "failed" &&
                      "border-primary/30 bg-primary/15 text-primary",
                  )}
                >
                  <span>Task #{task.id} · {taskLabel}</span>
                  <ExternalLink className="size-2.5 transition-transform group-hover:scale-110" />
                </Badge>
              </Link>
            ) : (
              <Badge
                variant={taskBadgeVariant}
                className={cn(
                  "h-5 rounded-full px-2 text-[10px]",
                  isUser && "border-primary/30 bg-primary/15 text-primary",
                )}
              >
                {taskLabel}
              </Badge>
            )
          )}
        </div>

        {/* Pixel Messages Asymmetrical Rounded Bubble */}
        <div
          className={cn(
            "px-4.5 py-3.5 text-foreground shadow-sm transition-all duration-200",
            isUser
              ? "rounded-3xl rounded-tr-md bg-primary/20 border border-primary/30 text-foreground"
              : "rounded-3xl rounded-tl-md bg-secondary/60 border border-border/70 text-foreground",
            isError && "bg-destructive/15 text-foreground border-destructive/40",
          )}
        >
          <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed md:text-sm md:leading-6">
            <MessageContent content={message.content} />
          </div>
        </div>

        <time
          className="mt-1 px-1.5 font-mono text-[10px] text-muted-foreground/80"
          dateTime={message.created_at}
        >
          {formatTime(message.created_at)}
        </time>
      </div>

      {isUser && (
        <Avatar className="size-9.5 shadow-sm rounded-full ring-2 ring-card">
          <AvatarFallback className="rounded-full bg-primary/20 text-primary font-bold">
            <UserRound aria-hidden="true" className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </article>
  )
}

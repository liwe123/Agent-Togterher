"use client"

import { AlertTriangle, Check, Copy, ExternalLink, UserRound } from "@/components/ui/icons"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"

import { BotMark } from "@/components/console/bot-mark"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { botShapeForRole } from "@/lib/bot-shapes"
import { linkMentions } from "@/lib/mention-utils"
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

/** 保留 mention:// 内部协议，其余 URL 仍走 react-markdown 的安全白名单。 */
function keepMentionUrl(url: string): string {
  return url.startsWith("mention://") ? url : defaultUrlTransform(url)
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

interface MentionChipProps {
  id: number
  label: string
  agentById?: Map<number, Agent>
  /** 用户气泡是反色面（bg-console-user），chip 需改用继承色系保证可读。 */
  isUser?: boolean
}

/**
 * 行内 @ 引用 chip（DS-Bot §4.1 / P0-7）：14px 头像 + 名字，无下划线，
 * 点击直接跳到群聊输入框并预填 @name。
 */
function MentionChip({ id, label, agentById, isUser = false }: MentionChipProps) {
  const router = useRouter()
  const agent = agentById?.get(id)
  const name = agent?.name ?? label
  const href = `/chats?mention=${encodeURIComponent(name)}`

  return (
    <Link
      href={href}
      onClick={(event) => {
        // 保留 <a> 语义，但导航走客户端路由，避免整页刷新。
        event.preventDefault()
        event.stopPropagation()
        router.push(href)
      }}
      title={`向 ${name} 发起协作`}
      data-user-bubble={isUser || undefined}
      className={cn(
        "mx-0.5 inline-flex min-h-0! max-w-full items-center gap-1 rounded-md px-1 align-baseline text-[0.94em] font-medium no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/45 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none",
        isUser
          ? "bg-black/10 text-inherit hover:bg-black/15"
          : "bg-console-tag text-console-ink-2 hover:bg-console-hover hover:text-console-ink",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-full",
          isUser ? "bg-black/10 text-inherit" : "bg-console-raised text-console-ink-2",
        )}
        aria-hidden="true"
      >
        {agent ? (
          <BotMark
            shape={botShapeForRole(agent.role)}
            size={13}
            state="idle"
            ink="currentColor"
          />
        ) : (
          <span className="text-[9px] leading-none">{name.slice(0, 1)}</span>
        )}
      </span>
      <span className="truncate">{name}</span>
    </Link>
  )
}

interface MessageContentProps {
  content: string
  agentById?: Map<number, Agent>
  selfId: number | null
  isUser: boolean
}

function MessageContent({ content, agentById, selfId, isUser }: MessageContentProps) {
  const mentionAgents = useMemo(
    () =>
      Array.from(agentById?.values() ?? []).map((agent) => ({
        id: agent.id,
        name: agent.name,
      })),
    [agentById],
  )
  const linked = useMemo(
    () => linkMentions(content, mentionAgents, selfId),
    [content, mentionAgents, selfId],
  )

  return (
    <ReactMarkdown
      skipHtml
      urlTransform={keepMentionUrl}
      components={{
        a: ({ href, children }) => {
          const target = typeof href === "string" ? href : ""
          if (target.startsWith("mention://")) {
            const mentionId = Number.parseInt(target.slice("mention://".length), 10)
            const label = typeof children === "string" ? children : ""
            return (
              <MentionChip
                id={Number.isNaN(mentionId) ? 0 : mentionId}
                label={label}
                agentById={agentById}
                isUser={isUser}
              />
            )
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                "font-medium underline underline-offset-4 transition-opacity hover:opacity-80",
                isUser ? "text-inherit" : "text-console-accent",
              )}
            >
              {children}
            </a>
          )
        },
        code: ({ className, children }) => {
          const isBlock = className?.startsWith("language-")
          return isBlock ? (
            <code
              className={cn(
                "block overflow-x-auto rounded-console-md p-3 font-mono text-xs leading-5",
                isUser
                  ? "bg-black/10 text-inherit"
                  : "bg-console-tag text-console-ink-2",
                className,
              )}
            >
              {children}
            </code>
          ) : (
            <code
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-[0.88em] font-medium",
                isUser
                  ? "bg-black/10 text-inherit"
                  : "bg-console-tag text-console-ink",
              )}
            >
              {children}
            </code>
          )
        },
        pre: ({ children }) => <pre className="my-2 overflow-x-auto">{children}</pre>,
        ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
        h1: ({ children }) => (
          <h1 className="mb-1.5 mt-2 text-base font-bold tracking-tight text-inherit">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-1.5 mt-2 text-[15px] font-bold tracking-tight text-inherit">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-1.5 text-sm font-semibold text-inherit">{children}</h3>
        ),
        p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
      }}
    >
      {linked}
    </ReactMarkdown>
  )
}

interface MessageToolbarProps {
  message: ChatMessage
  task?: ChatTask
  align: "start" | "end"
}

/**
 * 悬停工具条（P0-5）：预留气泡右侧 82px，hover / 键盘聚焦才出现；
 * 触屏（pointer: coarse）常显，避免「无可 hover」导致操作不可达。
 */
function MessageToolbar({ message, task, align }: MessageToolbarProps) {
  const [copied, setCopied] = useState(false)

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默降级，不打断阅读。
    }
  }

  return (
    <div
      className={cn(
        "absolute top-0.5 flex items-center gap-0.5 rounded-lg border-[0.5px] border-console-line bg-console-raised/95 p-0.5 shadow-sm backdrop-blur-sm",
        "opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100",
        "[[data-motion=quiet]_&]:transition-none motion-reduce:transition-none",
        "[@media(pointer:coarse)]:opacity-100",
        align === "start" ? "left-full ml-1.5" : "right-full mr-1.5",
      )}
      role="toolbar"
      aria-label="消息操作"
    >
      <button
        type="button"
        onClick={() => void copyContent()}
        title={copied ? "已复制" : "复制内容"}
        aria-label={copied ? "已复制消息内容" : "复制消息内容"}
        className="flex size-6 items-center justify-center rounded-md text-console-ink-3 transition-colors hover:bg-console-hover hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/45"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3.5 text-console-success" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
      </button>
      {task ? (
        <Link
          href={`/tasks/${task.id}`}
          title="查看任务详情"
          aria-label={`查看 Task #${task.id} 详情`}
          className="flex size-6 items-center justify-center rounded-md text-console-ink-3 transition-colors hover:bg-console-hover hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/45"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      ) : null}
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  agent?: Agent
  agentIndex?: number
  task?: ChatTask
  /** 同一 Agent 的已知成员表，用于渲染 @ 引用 chip 的头像与名字。 */
  agentById?: Map<number, Agent>
  /** 连续同发送者分组：是否分组首条（显示头像、名称与时间）。 */
  groupStart?: boolean
  /** 是否分组末条（气泡下侧收窄 6px）。 */
  groupEnd?: boolean
  showTime?: boolean
  /** 接力任务中的棒次（第 index/total 棒）。 */
  relayHop?: { index: number; total: number } | null
}

export function MessageBubble({
  message,
  agent,
  agentIndex = 0,
  task,
  agentById,
  groupStart = true,
  groupEnd = true,
  showTime = true,
  relayHop = null,
}: MessageBubbleProps) {
  const isUser = message.sender_type === "user"
  const isSystemLike =
    message.sender_type === "system" || message.message_type === "error"
  const isError = message.message_type === "error"
  const senderName = isUser ? "你" : agent?.name ?? "Agent"
  const taskLabel = task
    ? taskStatusLabels[task.status] ?? task.status
    : message.message_type === "task"
      ? "任务消息"
      : null
  const taskTone =
    task?.status === "failed"
      ? "text-console-danger"
      : task?.status === "running"
        ? "text-console-accent"
        : task?.status === "completed"
          ? "text-console-success"
          : "text-console-tag-ink"

  // 系统消息与错误事件统一渲染为居中事件行（DS-Bot 事件语法），不再是带边框的小气泡。
  if (isSystemLike) {
    return (
      <article role="status" className="flex justify-center px-2 py-2">
        <div
          className={cn(
            "flex max-w-[92%] items-center gap-1.5 text-center text-xs leading-[18px]",
            isError ? "text-console-danger" : "text-console-ink-2",
          )}
        >
          {isError ? (
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
          ) : null}
          <span className="whitespace-pre-wrap break-words">{message.content}</span>
          <time
            className="shrink-0 text-[11px] text-console-ink-3 console-tabular"
            dateTime={message.created_at}
          >
            {formatTime(message.created_at)}
          </time>
        </div>
      </article>
    )
  }

  const selfId =
    message.sender_type === "agent" && message.sender_id !== null
      ? message.sender_id
      : null

  return (
    <article
      className={cn(
        "group/msg flex w-full items-start gap-2",
        isUser ? "justify-end" : "justify-start",
        groupStart ? "mt-4" : "mt-1",
      )}
      data-message-type={message.message_type}
      data-group-start={groupStart || undefined}
      data-group-end={groupEnd || undefined}
    >
      {!isUser &&
        (groupStart ? (
          <span
            className="agent-avatar mt-0.5 flex size-[22px] shrink-0 items-center justify-center overflow-hidden rounded-full"
            data-tone={agentIndex % 6}
            aria-hidden="true"
          >
            <BotMark
              shape={botShapeForRole(agent?.role ?? "")}
              size={16}
              state={agent?.status === "running" ? "running" : "idle"}
              ink="var(--avatar-tone, var(--console-accent))"
            />
          </span>
        ) : (
          <span className="w-[22px] shrink-0" aria-hidden="true" />
        ))}

      <div
        className={cn(
          "flex min-w-0 flex-col",
          isUser ? "items-end" : "items-start",
          "max-w-[min(var(--console-msg-w,80%),calc(100%-5.125rem))]",
        )}
      >
        {groupStart && (
          <div className="mb-1 flex max-w-full min-w-0 items-center gap-1.5 px-0.5">
            <span className="truncate text-[13px] font-bold text-console-ink">
              {senderName}
            </span>
            {relayHop && !isUser ? (
              <span
                className="inline-flex h-4 shrink-0 items-center rounded-full bg-console-tag px-1.5 text-[10px] font-semibold text-console-tag-ink console-tabular"
                title={`接力第 ${relayHop.index}/${relayHop.total} 棒`}
              >
                接力 {relayHop.index}/{relayHop.total}
              </span>
            ) : null}
            <time
              className="shrink-0 text-[11px] text-console-ink-3 console-tabular"
              dateTime={message.created_at}
            >
              {formatTime(message.created_at)}
            </time>
            {taskLabel ? (
              task ? (
                <Link
                  href={`/tasks/${task.id}`}
                  title={`查看 Task #${task.id} 详情`}
                  className={cn(
                    "group/task inline-flex h-5 min-h-0! max-w-[11rem] shrink-0 items-center gap-1 rounded-full border-[0.5px] border-console-line bg-console-tag px-2 text-[11px] font-medium transition-colors hover:bg-console-hover motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none",
                    taskTone,
                  )}
                >
                  <span className="truncate">
                    Task #{task.id} · {taskLabel}
                  </span>
                  <ExternalLink
                    aria-hidden="true"
                    className="size-2.5 shrink-0 transition-transform group-hover/task:scale-110 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none"
                  />
                </Link>
              ) : (
                <span
                  className={cn(
                    "inline-flex h-5 shrink-0 items-center rounded-full bg-console-tag px-2 text-[11px] font-medium",
                    taskTone,
                  )}
                >
                  {taskLabel}
                </span>
              )
            ) : null}
          </div>
        )}

        <div className="relative max-w-full">
          <div
            className={cn(
              "max-w-full px-3.5 py-2 text-[15px] leading-6 md:text-sm md:leading-[22px]",
              "break-words [overflow-wrap:anywhere]",
              isUser
                ? "bg-console-user text-console-user-ink"
                : "bg-console-surface-2 text-console-ink",
              "console-hairline rounded-console-xl",
              groupStart &&
                (isUser ? "rounded-tr-console-xs" : "rounded-tl-console-xs"),
              groupEnd &&
                (isUser ? "rounded-br-console-xs" : "rounded-bl-console-xs"),
            )}
          >
            <MessageContent
              content={message.content}
              agentById={agentById}
              selfId={selfId}
              isUser={isUser}
            />
          </div>

          <MessageToolbar
            message={message}
            task={task}
            align={isUser ? "end" : "start"}
          />
        </div>

        {showTime && !groupStart ? (
          <time
            className="mt-1 px-1 text-[11px] text-console-ink-3 console-tabular"
            dateTime={message.created_at}
          >
            {formatTime(message.created_at)}
          </time>
        ) : null}
      </div>

      {isUser &&
        (groupStart ? (
          <Avatar
            className="mt-0.5 size-[22px] shrink-0 rounded-full"
            aria-hidden="true"
          >
            <AvatarFallback className="rounded-full bg-console-tag text-console-ink-2">
              <UserRound aria-hidden="true" className="size-3" />
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="w-[22px] shrink-0" aria-hidden="true" />
        ))}
    </article>
  )
}

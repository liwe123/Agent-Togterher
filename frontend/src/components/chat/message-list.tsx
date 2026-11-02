"use client"

import { ArrowDown, MessagesSquare } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { TaskApprovalCard } from "@/components/chat/action-card"
import { MessageBubble } from "@/components/chat/message-bubble"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { EmptyState, ShimmerText, SkeletonRows } from "@/components/ui/feedback"
import type { ApprovalPlacement } from "@/lib/action-cards"
import { assignRelayHops, buildMessageTimeline } from "@/lib/relay-utils"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"
import type { ChatMessage, ChatTask } from "@/types/chat"

export interface TypingState {
  agent?: Agent
  label?: string
}

/** 人工审批卡的操作控制器：由 chat-page 持有状态（busy / error / 权限）。 */
export interface ApprovalController {
  canApprove: boolean
  busyTaskId: number | null
  errors: ReadonlyMap<number, string>
  /** 本会话内保存的自定义说明（不入库）。 */
  notes: ReadonlyMap<number, string>
  onApprove: (taskId: number) => void
  onReject: (taskId: number) => void
  onDismiss: (taskId: number) => void
  onSaveNote: (taskId: number, note: string) => void
}

interface MessageListProps {
  messages: ChatMessage[]
  tasks: ChatTask[]
  agents: Agent[]
  isLoading: boolean
  /** 列表尾部的「正在输入」行：isSending 或接力活跃时由 chat-page 注入。 */
  typing?: TypingState | null
  /** 待审批任务落位：行内卡挂在触发消息下方，避免与 composer 浮层重复。 */
  approvals?: ApprovalPlacement | null
  approvalController?: ApprovalController | null
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function sameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
}

/**
 * 时间分隔文案（P1-3）：跨天 / 首条显示「今天 · 昨天 · 日期」，同一天超过 30 分钟显示时钟。
 */
function resolveSeparator(
  entryDayLabel: string | null,
  message: ChatMessage,
  previous: ChatMessage | null,
): string | null {
  if (!entryDayLabel) return null
  if (!previous) return entryDayLabel
  const current = new Date(message.created_at)
  const earlier = new Date(previous.created_at)
  if (
    Number.isNaN(current.getTime()) ||
    Number.isNaN(earlier.getTime()) ||
    !sameCalendarDay(current, earlier)
  ) {
    return entryDayLabel
  }
  return formatClock(message.created_at)
}

/**
 * 列表尾部 typing 行（P1-9）：28px 头像 + shimmer 文案 + tabular 计时。
 * 容器常驻，靠高度/透明度过渡实现「淡出离场」，reduced-motion 与 quiet 档位下只保留透明度。
 */
function TypingIndicator({ typing }: { typing?: TypingState | null }) {
  const active = Boolean(typing)
  const [elapsed, setElapsed] = useState(0)

  // 组件由父级按「typing 身份」重挂载，计时天然从 0 开始；effect 只负责订阅计时器。
  useEffect(() => {
    if (!active) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  const agent = typing?.agent
  const tone = agent ? agent.id % 6 : 0

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 overflow-hidden pl-1 transition-all duration-[var(--console-dur-tap,290ms)] ease-out",
        "[[data-motion=quiet]_&]:transition-[opacity] motion-reduce:transition-none",
        active ? "mt-2 h-9 opacity-100" : "mt-0 h-0 opacity-0",
      )}
      role={active ? "status" : undefined}
      aria-live={active ? "polite" : undefined}
      aria-hidden={active ? undefined : true}
    >
      <Avatar
        className={cn("agent-avatar size-7 shrink-0 rounded-full", agent?.status === "running" && "console-state-bob")}
        data-tone={tone}
        data-state={agent?.status ?? "idle"}
        aria-hidden="true"
      >
        <AvatarFallback className="rounded-full text-[12px] leading-none">
          {agent?.avatar ?? agent?.name?.slice(0, 1) ?? "···"}
        </AvatarFallback>
      </Avatar>
      <ShimmerText className="min-w-0 truncate text-[13px] [[data-motion=quiet]_&]:text-console-ink-2 motion-reduce:text-console-ink-2">
        {typing?.label ?? "正在输入…"}
      </ShimmerText>
      <span className="shrink-0 text-[11px] text-console-ink-3 console-tabular">
        {formatElapsed(elapsed)}
      </span>
    </div>
  )
}

export function MessageList({
  messages,
  tasks,
  agents,
  isLoading,
  typing = null,
  approvals = null,
  approvalController = null,
}: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const previousMessageCount = useRef(0)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const taskByMessageId = useMemo(
    () =>
      new Map(
        tasks
          .filter((task) => task.input_message_id !== null)
          .map((task) => [task.input_message_id as number, task]),
      ),
    [tasks],
  )
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  )
  const agentIndexById = useMemo(
    () => new Map(agents.map((agent, index) => [agent.id, index])),
    [agents],
  )
  const relayHops = useMemo(
    () => assignRelayHops(messages, tasks),
    [messages, tasks],
  )
  const timeline = useMemo(
    () => buildMessageTimeline(messages, { relayHops }),
    [messages, relayHops],
  )
  const timelineItems = useMemo(
    () =>
      timeline.map((entry, index) => ({
        entry,
        separator: resolveSeparator(
          entry.dayLabel,
          entry.message,
          index > 0 ? messages[index - 1] : null,
        ),
      })),
    [timeline, messages],
  )

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    isAtBottomRef.current = true
    setShowScrollButton(false)
  }

  useEffect(() => {
    const isInitialLoad =
      previousMessageCount.current === 0 && messages.length > 0
    if (isInitialLoad || isAtBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("auto"))
    } else if (messages.length > previousMessageCount.current) {
      setShowScrollButton(true)
    }
    previousMessageCount.current = messages.length
  }, [messages])

  // typing 行出现时若原本在底部，顺手把视口带到底部，避免它被折叠在下方。
  const typingActive = Boolean(typing)
  useEffect(() => {
    if (typingActive && isAtBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("auto"))
    }
  }, [typingActive])

  function handleScroll() {
    const viewport = viewportRef.current
    if (!viewport) return
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    const isAtBottom = distanceFromBottom < 64
    isAtBottomRef.current = isAtBottom
    setShowScrollButton(!isAtBottom)
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="console-scroll [scrollbar-gutter:stable] h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 lg:px-8"
        aria-live="polite"
        aria-label="群聊消息"
      >
        {isLoading ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4" aria-label="正在加载消息">
            <SkeletonRows rows={4} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-64 items-center justify-center">
            <EmptyState
              icon={<MessagesSquare aria-hidden="true" className="size-5" />}
              title="开始第一次协作"
              description="直接输入需求会交给项目总设计师；也可以 @ 一位 Agent 分工，或 @ 多位 Agent 让它们按顺序接力协作。"
              className="max-w-sm"
            />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col">
            {timelineItems.map(({ entry, separator }) => {
              const { message, relayHop } = entry
              const agent =
                message.sender_id === null
                  ? undefined
                  : agentById.get(message.sender_id)
              const approvalCard =
                approvals?.inlineByMessageId.get(message.id) ?? null
              const approvalAgent = approvalCard
                ? agentById.get(approvalCard.assigned_agent_id ?? -1)
                : undefined
              return (
                <div key={message.id}>
                  {separator ? (
                    <div
                      role="separator"
                      aria-label={separator}
                      className="my-3.5 flex h-7 items-center justify-center text-xs text-console-ink-3 console-tabular"
                    >
                      <span>{separator}</span>
                    </div>
                  ) : null}
                  <MessageBubble
                    message={message}
                    agent={agent}
                    agentIndex={
                      message.sender_id === null
                        ? 0
                        : agentIndexById.get(message.sender_id)
                    }
                    task={taskByMessageId.get(message.id)}
                    agentById={agentById}
                    groupStart={entry.groupStart}
                    groupEnd={entry.groupEnd}
                    showTime={entry.showTime}
                    relayHop={relayHop}
                  />
                  {approvalCard && approvalController ? (
                    <div className="mt-2 mb-1 ml-[30px] max-w-[min(var(--console-msg-w,80%),calc(100%-5.125rem))]">
                      <TaskApprovalCard
                        task={approvalCard}
                        agent={approvalAgent}
                        variant="inline"
                        busy={approvalController.busyTaskId === approvalCard.id}
                        error={
                          approvalController.errors.get(approvalCard.id) ?? null
                        }
                        canApprove={approvalController.canApprove}
                        initialNote={approvalController.notes.get(approvalCard.id)}
                        onApprove={approvalController.onApprove}
                        onReject={approvalController.onReject}
                        onDismiss={approvalController.onDismiss}
                        onSaveNote={approvalController.onSaveNote}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <div className="mx-auto w-full max-w-4xl">
          <TypingIndicator
            key={typing ? `${typing.agent?.id ?? "x"}:${typing.label ?? ""}` : "idle"}
            typing={typing}
          />
        </div>
      </div>

      {showScrollButton && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => scrollToBottom()}
          className="absolute right-4 bottom-4 z-10 rounded-full border-[0.5px] border-console-line bg-console-raised/90 px-4 shadow-lg backdrop-blur-md transition-all hover:scale-105 active:scale-95 sm:right-6"
        >
          <ArrowDown data-icon="inline-start" className="size-3.5 text-console-accent" />
          回到底部
        </Button>
      )}
    </div>
  )
}

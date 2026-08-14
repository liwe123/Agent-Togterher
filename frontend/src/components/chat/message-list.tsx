"use client"

import { ArrowDown, MessagesSquare } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { MessageBubble } from "@/components/chat/message-bubble"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { Agent } from "@/types/agent"
import type { ChatMessage, ChatTask } from "@/types/chat"

interface MessageListProps {
  messages: ChatMessage[]
  tasks: ChatTask[]
  agents: Agent[]
  isLoading: boolean
}

export function MessageList({
  messages,
  tasks,
  agents,
  isLoading,
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

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
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

  function handleScroll() {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
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
        className="scrollbar-thin h-full overflow-y-auto overscroll-contain px-3 py-5 sm:px-5 sm:py-6 lg:px-8"
        aria-live="polite"
        aria-label="群聊消息"
      >
        {isLoading ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5" aria-label="正在加载消息">
            <div className="flex items-end gap-3">
              <Skeleton className="size-9.5 rounded-full" />
              <Skeleton className="h-20 w-[62%] rounded-3xl" />
            </div>
            <div className="flex items-end justify-end gap-3">
              <Skeleton className="h-16 w-[54%] rounded-3xl" />
              <Skeleton className="size-9.5 rounded-full" />
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-3xl bg-primary/15 text-primary shadow-sm">
              <MessagesSquare aria-hidden="true" className="size-6" />
            </span>
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground">开始第一次协作</p>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                直接输入需求会交给项目总设计师，也可以输入 @ 指定一位 Agent 分工协同。
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
            {messages.map((message) => {
              const agent =
                message.sender_id === null
                  ? undefined
                  : agentById.get(message.sender_id)
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  agent={agent}
                  agentIndex={
                    message.sender_id === null
                      ? 0
                      : agentIndexById.get(message.sender_id)
                  }
                  task={taskByMessageId.get(message.id)}
                />
              )
            })}
          </div>
        )}
      </div>

      {showScrollButton && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => scrollToBottom()}
          className="absolute right-4 bottom-4 z-10 rounded-full border border-border/80 bg-card/90 px-4 shadow-lg backdrop-blur-md transition-all hover:scale-105 active:scale-95 sm:right-6"
        >
          <ArrowDown data-icon="inline-start" className="size-3.5 text-primary" />
          回到底部
        </Button>
      )}
    </div>
  )
}

"use client"

import { CornerDownLeft, Send, Trash2 } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { MentionMenu } from "@/components/chat/mention-menu"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Agent } from "@/types/agent"

const mentionNames = [
  "项目总设计师",
  "Agent工程师",
  "前端设计师",
  "知识库管理员",
  "测试专员",
  "运维",
] as const

interface MentionMatch {
  start: number
  query: string
}

function findMention(value: string, caret: number): MentionMatch | null {
  const beforeCaret = value.slice(0, caret)
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/)
  if (!match) {
    return null
  }

  return {
    start: beforeCaret.lastIndexOf("@"),
    query: match[2].toLocaleLowerCase("zh-CN"),
  }
}

interface ChatComposerProps {
  agents: Agent[]
  disabled: boolean
  isSending: boolean
  onSend: (content: string) => Promise<boolean>
}

export function ChatComposer({
  agents,
  disabled,
  isSending,
  onSend,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState("")
  const [mention, setMention] = useState<MentionMatch | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)

  const orderedAgents = useMemo(
    () =>
      mentionNames
        .map((name) => agents.find((agent) => agent.name === name))
        .filter((agent): agent is Agent => agent !== undefined),
    [agents],
  )
  const filteredAgents = useMemo(() => {
    if (!mention) {
      return []
    }
    return orderedAgents.filter((agent) =>
      agent.name.toLocaleLowerCase("zh-CN").includes(mention.query),
    )
  }, [mention, orderedAgents])
  const isMentionOpen = mention !== null && filteredAgents.length > 0

  function updateMention(nextValue: string, caret: number | null) {
    const nextMention = findMention(nextValue, caret ?? nextValue.length)
    setMention(nextMention)
    setActiveMentionIndex(0)
  }

  function selectMention(agent: Agent) {
    if (!mention) {
      return
    }
    const textarea = textareaRef.current
    const caret = textarea?.selectionStart ?? value.length
    const nextValue = `${value.slice(0, mention.start)}@${agent.name} ${value.slice(caret)}`
    const nextCaret = mention.start + agent.name.length + 2
    setValue(nextValue)
    setMention(null)
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  async function submitMessage() {
    const content = value.trim()
    if (!content || disabled || isSending) {
      return
    }
    const sent = await onSend(content)
    if (sent) {
      setValue("")
      setMention(null)
      textareaRef.current?.focus()
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isMentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActiveMentionIndex(
          (index) => (index + 1) % filteredAgents.length,
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setActiveMentionIndex(
          (index) => (index - 1 + filteredAgents.length) % filteredAgents.length,
        )
        return
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        selectMention(filteredAgents[activeMentionIndex])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMention(null)
        return
      }
    }

    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      void submitMessage()
    }
  }

  function clearInput() {
    setValue("")
    setMention(null)
    textareaRef.current?.focus()
  }

  return (
    <div className="border-t border-border bg-card px-3 py-3 sm:px-5 sm:py-4">
      <div className="relative mx-auto w-full max-w-4xl">
        {isMentionOpen && (
          <MentionMenu
            agents={filteredAgents}
            activeIndex={activeMentionIndex}
            onSelect={selectMention}
          />
        )}

        <div className="rounded-lg border border-input bg-background/70 p-2 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <Textarea
            ref={textareaRef}
            value={value}
            disabled={disabled || isSending}
            rows={2}
            placeholder="输入消息，或使用 @ 指定 Agent…"
            aria-label="输入群聊消息"
            aria-expanded={isMentionOpen}
            onChange={(event) => {
              setValue(event.target.value)
              updateMention(event.target.value, event.target.selectionStart)
            }}
            onClick={(event) =>
              updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onKeyUp={(event) => {
              if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
                return
              }
              updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
            }}
            onKeyDown={handleKeyDown}
            className="min-h-16 max-h-40 border-0 bg-transparent px-2 py-1 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="hidden items-center gap-1.5 px-2 text-[11px] text-muted-foreground sm:flex">
              <CornerDownLeft aria-hidden="true" className="size-3" />
              Enter 发送 · Shift + Enter 换行 · 输入 @ 选择 Agent
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!value || isSending}
                onClick={clearInput}
                aria-label="清空输入框"
                title="清空输入框"
              >
                <Trash2 />
              </Button>
              <Button
                type="button"
                size="lg"
                disabled={!value.trim() || disabled || isSending}
                onClick={() => void submitMessage()}
              >
                <Send data-icon="inline-start" />
                {isSending ? "发送中" : "发送"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

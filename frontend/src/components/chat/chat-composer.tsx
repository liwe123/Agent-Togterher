"use client"

import { CornerDownLeft, Send, Sparkles, Trash2, Zap } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { MentionMenu } from "@/components/chat/mention-menu"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Agent } from "@/types/agent"

const roleOrder: Record<string, number> = {
  project_architect: 0,
  agent_engineer: 1,
  frontend_designer: 2,
  knowledge_manager: 3,
  qa_engineer: 4,
  operations_engineer: 5,
}

const promptTemplates = [
  { label: "设计系统方案", text: "@项目总设计师 请分析并输出系统架构方案" },
  { label: "优化 UI 视觉", text: "@前端设计师 请为当前控制台页面优化视觉体验" },
  { label: "编写后端代码", text: "@Agent工程师 请检查并重构后端 API 服务" },
  { label: "自动化测试", text: "@测试专员 请执行全量功能质量检查" },
]

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
  const searchParams = useSearchParams()
  const initialValue = useMemo(() => {
    const mentionParam = searchParams.get("mention")
    return mentionParam ? `@${mentionParam} ` : ""
  }, [searchParams])

  const [value, setValue] = useState(initialValue)
  const [mention, setMention] = useState<MentionMatch | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false)

  useEffect(() => {
    const mentionParam = searchParams.get("mention")
    if (!mentionParam) return

    const token = `@${mentionParam}`
    const frame = requestAnimationFrame(() => {
      setValue((current) => {
        if (current.includes(token)) return current
        return current.trim() ? `${current.trimEnd()} ${token} ` : `${token} `
      })
      textareaRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [searchParams])

  const orderedAgents = useMemo(
    () =>
      [...agents].sort(
        (left, right) =>
          (roleOrder[left.role] ?? Number.MAX_SAFE_INTEGER) -
          (roleOrder[right.role] ?? Number.MAX_SAFE_INTEGER) ||
          left.name.localeCompare(right.name, "zh-CN"),
      ),
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
      setValue((prev) => `${prev.trim()} @${agent.name} `.trimStart())
      textareaRef.current?.focus()
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

  function appendTemplate(text: string) {
    setValue(text)
    textareaRef.current?.focus()
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
    <div className="border-t border-border/70 bg-card/90 backdrop-blur-xl px-4 py-3 md:px-6 md:py-4">
      <div className="relative mx-auto w-full max-w-4xl space-y-3">
        {mobileActionsOpen ? (
          <div className="space-y-3 rounded-3xl border border-border/80 bg-card p-4 shadow-xl md:hidden">
            <div>
              <p className="mb-2 text-xs font-semibold text-foreground">快捷指令</p>
              <div className="flex flex-wrap gap-2">
                {promptTemplates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="min-h-10 rounded-full border border-border/80 bg-secondary/60 px-3.5 text-xs text-foreground font-medium"
                    onClick={() => {
                      appendTemplate(template.text)
                      setMobileActionsOpen(false)
                    }}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-foreground">选择 Agent</p>
              <div className="flex flex-wrap gap-2">
                {orderedAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className="min-h-10 rounded-full border border-border/80 bg-secondary/60 px-3.5 text-xs text-foreground font-medium"
                    onClick={() => {
                      selectMention(agent)
                      setMobileActionsOpen(false)
                    }}
                  >
                    @{agent.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Quick prompt templates & agent mention chips */}
        <div className="hidden items-center justify-between gap-2 overflow-x-auto scrollbar-thin pb-0.5 md:flex">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span className="font-medium text-foreground/80">快捷指令：</span>
            {promptTemplates.map((tmpl) => (
              <button
                key={tmpl.label}
                type="button"
                onClick={() => appendTemplate(tmpl.text)}
                className="rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-[11px] font-medium text-foreground/90 hover:border-primary/50 hover:bg-primary/15 hover:text-primary transition-all active:scale-95"
              >
                {tmpl.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            {orderedAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                title={`@${agent.name}`}
                onClick={() => selectMention(agent)}
                className="flex items-center gap-1 rounded-full border border-border/60 bg-secondary/40 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-foreground transition-all active:scale-95"
              >
                <span>{agent.avatar ?? "🤖"}</span>
                <span>@{agent.name.slice(0, 4)}</span>
              </button>
            ))}
          </div>
        </div>

        {isMentionOpen && (
          <MentionMenu
            agents={filteredAgents}
            activeIndex={activeMentionIndex}
            onSelect={selectMention}
          />
        )}

        {/* Pixel M3 Pill Composer Container */}
        <div className="flex items-end gap-2 rounded-3xl border border-border/80 bg-secondary/40 p-2 transition-all focus-within:border-primary focus-within:bg-card/90 focus-within:ring-2 focus-within:ring-primary/20 md:block md:rounded-3xl md:p-3.5 shadow-sm">
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary md:hidden"
            aria-label={mobileActionsOpen ? "关闭快捷操作" : "打开快捷操作"}
            aria-expanded={mobileActionsOpen}
            onClick={() => setMobileActionsOpen((open) => !open)}
          >
            <Zap aria-hidden="true" className="size-5" />
          </button>
          <Textarea
            ref={textareaRef}
            value={value}
            disabled={disabled || isSending}
            rows={1}
            placeholder="输入消息派发任务，或输入 @ 选择指定 Agent 协作…"
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
            className="min-h-10 min-w-0 flex-1 max-h-36 border-0 bg-transparent px-2 py-2 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 md:min-h-20 md:w-full md:px-2 md:py-1 md:text-sm"
          />

          <div className="flex shrink-0 items-center gap-3 md:w-full md:justify-between md:pt-2.5 md:border-t md:border-border/50">
            <p className="hidden items-center gap-1.5 px-2 text-[11px] text-muted-foreground md:flex">
              <CornerDownLeft aria-hidden="true" className="size-3 text-primary" />
              Enter 发送 · Shift + Enter 换行 · 输入 @ 召唤 Agent
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden size-9 rounded-full md:inline-flex"
                disabled={!value || isSending}
                onClick={clearInput}
                aria-label="清空输入框"
                title="清空输入框"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                type="button"
                size="lg"
                className="size-10 rounded-full px-0 md:h-9.5 md:w-auto md:px-5 shadow-md transition-all active:scale-95"
                disabled={!value.trim() || disabled || isSending}
                onClick={() => void submitMessage()}
              >
                <Send data-icon="inline-start" className="size-4" />
                <span className="hidden md:inline font-semibold">{isSending ? "发送中…" : "发送任务"}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

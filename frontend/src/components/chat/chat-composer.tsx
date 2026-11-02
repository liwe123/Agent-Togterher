"use client"

import { ArrowRight, CornerDownLeft, Send, Sparkles, Trash2, Zap } from "@/components/ui/icons"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { AgentGlyph } from "@/components/console/agent-glyph"
import { MentionMenu, type MentionEntry } from "@/components/chat/mention-menu"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  buildMentionEntries,
  filterMentionEntries,
  findMention,
  insertMention,
  type MentionMatch,
} from "@/lib/mention-utils"
import { buildRelayChainPreview } from "@/lib/relay-utils"
import type { Agent } from "@/types/agent"
import type { IntegrationNode } from "@/types/integration"

const promptTemplates = [
  { label: "设计系统方案", text: "@项目总设计师 请分析并输出系统架构方案" },
  { label: "优化 UI 视觉", text: "@前端设计师 请为当前控制台页面优化视觉体验" },
  { label: "编写后端代码", text: "@Agent工程师 请检查并重构后端 API 服务" },
  { label: "自动化测试", text: "@测试专员 请执行全量功能质量检查" },
]

interface ChatComposerProps {
  agents: Agent[]
  integrationNodes?: IntegrationNode[]
  disabled: boolean
  isSending: boolean
  onSend: (content: string) => Promise<boolean>
}

export function ChatComposer({
  agents,
  integrationNodes = [],
  disabled,
  isSending,
  onSend,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerContainerRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!mention) return

    function handlePointerDown(event: MouseEvent) {
      if (
        composerContainerRef.current &&
        !composerContainerRef.current.contains(event.target as Node)
      ) {
        setMention(null)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
    }
  }, [mention])

  const allMentionEntries = useMemo<MentionEntry[]>(
    () => buildMentionEntries(agents, integrationNodes),
    [agents, integrationNodes],
  )

  const filteredEntries = useMemo(
    () => (mention ? filterMentionEntries(allMentionEntries, mention.query) : []),
    [mention, allMentionEntries],
  )

  const isMentionOpen = mention !== null && filteredEntries.length > 0

  // PRD FR4：输入多个 @ 时实时预览接力顺序（仅内部 Agent，按出现顺序去重）。
  const relayPreview = useMemo(
    () => buildRelayChainPreview(value, allMentionEntries),
    [value, allMentionEntries],
  )

  function updateMention(nextValue: string, caret: number | null) {
    const nextMention = findMention(nextValue, caret ?? nextValue.length)
    setMention(nextMention)
    setActiveMentionIndex(0)
  }

  function selectMention(entry: MentionEntry) {
    if (!mention) {
      setValue((prev) => `${prev.trim()} @${entry.name} `.trimStart())
      textareaRef.current?.focus()
      return
    }
    const textarea = textareaRef.current
    const caret = textarea?.selectionStart ?? value.length
    const { nextValue, nextCaret } = insertMention(value, caret, mention, entry.name)
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
      if (event.nativeEvent.isComposing) {
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActiveMentionIndex(
          (index) => (index + 1) % filteredEntries.length,
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setActiveMentionIndex(
          (index) => (index - 1 + filteredEntries.length) % filteredEntries.length,
        )
        return
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault()
        selectMention(filteredEntries[activeMentionIndex])
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
    <div className="border-t-[0.5px] border-console-line bg-console-bg/85 px-4 py-3 backdrop-blur-xl md:px-6 md:py-4">
      <div className="mx-auto w-full max-w-4xl space-y-3">
        {mobileActionsOpen ? (
          <div className="space-y-3 rounded-console-lg border-[0.5px] border-console-line bg-console-surface p-4 md:hidden">
            <div>
              <p className="mb-2 text-xs font-semibold text-console-ink">快捷指令</p>
              <div className="flex flex-wrap gap-2">
                {promptTemplates.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="min-h-10 rounded-full border-[0.5px] border-console-line bg-console-tag px-3.5 text-xs font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
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
              <p className="mb-2 text-xs font-semibold text-console-ink">选择可 @ 的角色</p>
              <div className="flex flex-wrap gap-2">
                {allMentionEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className="min-h-10 rounded-full border-[0.5px] border-console-line bg-console-tag px-3.5 text-xs font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
                    onClick={() => {
                      selectMention(entry)
                      setMobileActionsOpen(false)
                    }}
                  >
                    @{entry.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Quick prompt templates & agent mention chips */}
        <div className="hidden items-center justify-between gap-2 overflow-x-auto scrollbar-thin pb-0.5 md:flex">
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span className="font-medium text-foreground/80">快捷指令：</span>
            {promptTemplates.map((tmpl) => (
              <button
                key={tmpl.label}
                type="button"
                onClick={() => appendTemplate(tmpl.text)}
                className="shrink-0 whitespace-nowrap rounded-full border-[0.5px] border-console-line bg-console-tag px-3 py-1 text-[11px] font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink active:scale-95"
              >
                {tmpl.label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {allMentionEntries.map((entry, index) => (
              <button
                key={entry.key}
                type="button"
                title={`@${entry.name} (${entry.roleLabel ?? entry.subtitle})`}
                onClick={() => selectMention(entry)}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-[0.5px] border-console-line bg-console-tag px-2.5 py-0.5 text-[11px] text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink active:scale-95"
              >
                <AgentGlyph
                  agent={entry.kind === "agent" ? { role: entry.role } : undefined}
                  kind={entry.kind}
                  toneIndex={index}
                  className="size-4"
                  markSize={12}
                />
                <span>@{entry.name.slice(0, 4)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 接力顺序预览：多 @ 时提示本轮将由这些 Agent 依次接力（PRD FR4） */}
        {relayPreview.length >= 2 ? (
          <div className="chat-relay-preview" aria-label="接力顺序预览">
            <span className="chat-relay-preview-label">接力顺序</span>
            <ol className="chat-relay-preview-list">
              {relayPreview.map((entry, index) => (
                <li key={entry.key} className="chat-relay-preview-item">
                  <span className="chat-relay-preview-index">{index + 1}</span>
                  <span className="chat-relay-preview-name">{entry.name}</span>
                  {index < relayPreview.length - 1 ? (
                    <ArrowRight
                      aria-hidden="true"
                      className="chat-relay-preview-arrow"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
            <span className="chat-relay-preview-hint">按顺序接力执行</span>
          </div>
        ) : null}

        {/* Dialogue box container with MentionMenu anchored directly above it */}
        <div ref={composerContainerRef} className="relative">
          {isMentionOpen && (
            <MentionMenu
              items={filteredEntries}
              activeIndex={activeMentionIndex}
              onSelect={selectMention}
            />
          )}

          {/* DS-Bot 输入卡皮肤：22px 圆角 + 0.5px 发丝描边 + accent 聚焦环 */}
          <div className="flex items-end gap-2 rounded-[22px] border-[0.5px] border-console-line-2 bg-console-raised p-2 transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-console-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--console-accent)_20%,transparent)] md:block md:p-3.5 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none">
            <button
              type="button"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-console-tag text-console-accent md:hidden"
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
              placeholder="输入消息派发任务，或输入 @ 选择指定角色协作…"
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
              className="min-h-10 min-w-0 flex-1 max-h-36 border-0 bg-transparent px-2 py-2 text-base text-console-ink shadow-none placeholder:text-[13px] placeholder:text-console-ink-3 focus-visible:border-transparent focus-visible:ring-0 md:min-h-20 md:w-full md:px-2 md:py-1 md:text-sm"
            />

            <div className="flex shrink-0 items-center gap-3 md:w-full md:justify-between md:pt-2.5 md:border-t md:border-border/50">
              <p className="hidden items-center gap-1.5 px-2 text-[11px] text-console-ink-3 md:flex">
                <CornerDownLeft aria-hidden="true" className="size-3 text-console-accent" />
                Enter 发送 · Shift + Enter 换行 · 输入 @ 召唤角色 · 多 @ 顺序接力
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
                  className="size-10 rounded-full bg-console-accent px-0 text-console-accent-ink shadow-sm transition-all hover:bg-[color-mix(in_srgb,var(--console-accent)_88%,var(--console-ink))] active:scale-95 disabled:opacity-45 disabled:shadow-none md:h-9.5 md:w-auto md:px-5 motion-reduce:transition-none"
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
    </div>
  )
}

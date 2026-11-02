"use client"

import { AlertTriangle, Check, ChevronRight, LoaderCircle, X } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { InlineError } from "@/components/ui/feedback"
import {
  actionIndexFromKey,
  approvalCardId,
  buildApprovalOptions,
  createActionCardArbiter,
  isEditableTarget,
  type ActionOption,
} from "@/lib/action-cards"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"
import type { ChatTask } from "@/types/chat"

/** 模块级仲裁器：同一时刻只有最新挂载的动作卡响应键盘 A/B/C（DS-Bot §3.3 / §4.4）。 */
const cardArbiter = createActionCardArbiter()

const OPTION_ROW_CLASS =
  "group/row flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-console-hover focus-visible:bg-console-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none"

export interface ActionCardSettled {
  label: string
  tone: "success" | "danger"
}

export interface ActionCardProps {
  /** 单卡仲裁 id：同一卡片复挂载时保持稳定。 */
  cardId: string
  title: string
  description?: string
  options: ActionOption[]
  variant?: "inline" | "dock"
  busy?: boolean
  error?: string | null
  /** false 时只读（例如非管理员看审批卡）。 */
  canRespond?: boolean
  readOnlyHint?: string
  /** 决策已落定时的紧凑态（raised → settled）。 */
  settled?: ActionCardSettled | null
  noteHint?: string
  /** 自定义说明的初始内容（切换卡片后回填本会话内已保存的说明）。 */
  initialNote?: string
  footer?: ReactNode
  onSelect: (option: ActionOption) => void
  onSubmitNote?: (note: string) => void
  onClose?: () => void
  className?: string
}

function OptionContent({ option }: { option: ActionOption }) {
  return (
    <>
      <span className="console-kbd shrink-0" aria-hidden="true">
        {option.key}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 font-medium text-console-ink">
          {option.label}
        </span>
        {option.description ? (
          <span className="mt-0.5 block text-xs leading-[17px] text-console-ink-3">
            {option.description}
          </span>
        ) : null}
      </span>
      {option.tone === "danger" ? (
        <AlertTriangle
          aria-hidden="true"
          className="size-3.5 shrink-0 text-console-danger"
        />
      ) : option.tone === "accent" ? (
        <Check aria-hidden="true" className="size-3.5 shrink-0 text-console-success" />
      ) : null}
      <ChevronRight
        aria-hidden="true"
        className="size-3.5 shrink-0 text-console-ink-3 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none"
      />
    </>
  )
}

/**
 * DS-Bot bt-q 动作卡语法：圆角 16 + 0.5px 内描边的 console-card，
 * head（15/22 600 标题 + 13/18 说明 + 关闭）/ body（选项键帽 A/B/C）/ foot（右对齐按钮）。
 * 支持 inline（消息流内）与 dock（输入框上方浮层）两态，决策成功后由父级替换为 settled 紧凑态。
 */
export function ActionCard({
  cardId,
  title,
  description,
  options,
  variant = "inline",
  busy = false,
  error = null,
  canRespond = true,
  readOnlyHint,
  settled = null,
  noteHint,
  initialNote = "",
  footer,
  onSelect,
  onSubmitNote,
  onClose,
  className,
}: ActionCardProps) {
  const router = useRouter()
  const titleId = useId()
  const noteId = useId()
  const cardRef = useRef<HTMLElement | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteValue, setNoteValue] = useState(initialNote)
  const [noteSaved, setNoteSaved] = useState(false)

  useEffect(() => {
    cardArbiter.register(cardId)
    return () => cardArbiter.unregister(cardId)
  }, [cardId])

  const triggerOption = useCallback(
    (option: ActionOption) => {
      if (option.kind === "link") {
        if (option.href) router.push(option.href)
        return
      }
      if (option.kind === "note") {
        setNoteOpen(true)
        return
      }
      onSelect(option)
    },
    [onSelect, router],
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (!canRespond || busy) return
      // 输入框 / 文本域内的字母键属于输入，不当快捷键。
      if (isEditableTarget(event.target)) return
      // 焦点停在页面其它控件（如详情面板按钮）时不抢字母键，避免误触发审批。
      const activeElement = document.activeElement
      if (
        activeElement !== null &&
        activeElement !== document.body &&
        !(cardRef.current?.contains(activeElement) ?? false)
      ) {
        return
      }
      const target = event.target
      const enclosingDialog =
        target instanceof Element ? target.closest('[role="dialog"]') : null
      if (enclosingDialog !== null && enclosingDialog !== cardRef.current) {
        // 别的 dialog 正在交互，本卡不抢键。
        return
      }
      if (!cardArbiter.isActive(cardId)) return
      const index = actionIndexFromKey(event.key)
      if (index === null || index >= options.length) return
      event.preventDefault()
      triggerOption(options[index])
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [busy, canRespond, cardId, options, triggerOption])

  function saveNote() {
    const trimmed = noteValue.trim()
    if (!trimmed) return
    onSubmitNote?.(trimmed)
    setNoteSaved(true)
  }

  const interactive = canRespond && !busy

  if (settled) {
    return (
      <section
        ref={cardRef}
        role="status"
        className={cn(
          "console-card flex w-full items-center gap-2 px-4 py-2.5",
          className,
        )}
      >
        {settled.tone === "success" ? (
          <Check aria-hidden="true" className="size-4 shrink-0 text-console-success" />
        ) : (
          <AlertTriangle
            aria-hidden="true"
            className="size-4 shrink-0 text-console-danger"
          />
        )}
        <p className="text-[13px] leading-[18px] font-medium text-console-ink">
          {settled.label}
        </p>
      </section>
    )
  }

  return (
    <section
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-variant={variant}
      className={cn(
        "console-card w-full overflow-hidden",
        variant === "dock" &&
          "border-[0.5px] border-console-line-2 shadow-[0_10px_20px_-3px_rgba(0,0,0,0.10),0_4px_6px_-4px_rgba(0,0,0,0.10)]",
        className,
      )}
    >
      <header className="flex items-start gap-2 px-4 pt-3.5 pb-3">
        <div className="min-w-0 flex-1">
          <h2
            id={titleId}
            className="text-[15px] leading-[22px] font-semibold text-console-ink"
          >
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[13px] leading-[18px] text-console-ink-2">
              {description}
            </p>
          ) : null}
        </div>
        {busy ? (
          <LoaderCircle
            aria-label="处理中"
            className="mt-1 size-4 shrink-0 animate-spin text-console-ink-3"
          />
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="稍后处理"
            title="稍后处理"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-console-ink-3 transition-colors duration-150 hover:bg-console-hover hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/45 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </header>

      {canRespond && options.length > 0 ? (
        <ul className="border-t-[0.5px] border-console-line">
          {options.map((option) => (
            <li
              key={option.key}
              className="border-t-[0.5px] border-console-line first:border-t-0"
            >
              {option.kind === "link" && option.href ? (
                <Link
                  href={option.href}
                  className={OPTION_ROW_CLASS}
                  aria-keyshortcuts={option.key}
                >
                  <OptionContent option={option} />
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={!interactive}
                  onClick={() => triggerOption(option)}
                  aria-keyshortcuts={option.key}
                  className={OPTION_ROW_CLASS}
                >
                  <OptionContent option={option} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {!canRespond && readOnlyHint ? (
        <div className="border-t-[0.5px] border-console-line px-4 py-3">
          <p className="text-[13px] leading-[18px] text-console-warn">{readOnlyHint}</p>
        </div>
      ) : null}

      {noteOpen ? (
        <div className="border-t-[0.5px] border-console-line px-4 py-3">
          <label htmlFor={noteId} className="console-section-title">
            自定义说明
          </label>
          <textarea
            id={noteId}
            rows={3}
            value={noteValue}
            onChange={(event) => {
              setNoteValue(event.target.value)
              setNoteSaved(false)
            }}
            placeholder="补充审批意见…"
            className="mt-1.5 w-full resize-none rounded-console-sm border-[0.5px] border-console-line-2 bg-console-bg px-2.5 py-2 text-[13px] leading-[18px] text-console-ink outline-none placeholder:text-console-ink-3 focus:border-console-accent"
          />
          <p className="mt-1.5 text-[11px] leading-4 text-console-ink-3">
            {noteHint ?? "说明仅本会话可见。"}
          </p>
          {noteSaved ? (
            <p role="status" className="mt-1 text-[11px] leading-4 text-console-success">
              已记录说明（仅本会话可见）
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setNoteOpen(false)}
              className="h-7 rounded-full px-3 text-[12px] font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
            >
              收起
            </button>
            <button
              type="button"
              disabled={!noteValue.trim()}
              onClick={saveNote}
              className="h-7 rounded-full bg-console-accent px-3 text-[12px] font-medium text-console-accent-ink transition-opacity disabled:opacity-45"
            >
              保存说明
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="px-4 pb-3">
          <InlineError message={error} />
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t-[0.5px] border-console-line px-4 py-2.5">
        <span className="console-meta">
          {canRespond && options.length > 0 ? "按 A / B / C 快捷选择" : ""}
        </span>
        {footer ? <div className="flex items-center gap-2">{footer}</div> : null}
      </footer>
    </section>
  )
}

export interface TaskApprovalCardProps {
  task: ChatTask
  agent?: Agent
  variant?: "inline" | "dock"
  busy?: boolean
  error?: string | null
  canApprove: boolean
  /** 本会话内已保存的自定义说明（不入库）。 */
  initialNote?: string
  onApprove: (taskId: number) => void
  onReject: (taskId: number) => void
  onDismiss?: (taskId: number) => void
  onSaveNote?: (taskId: number, note: string) => void
}

/**
 * 任务人工审批卡（P0-6）：A 批准 / B 驳回 真实调用后端审批端点；
 * C 展开「自定义说明」输入，仅本会话可见（后端审批接口暂无备注字段）。
 */
export function TaskApprovalCard({
  task,
  agent,
  variant = "inline",
  busy = false,
  error = null,
  canApprove,
  initialNote,
  onApprove,
  onReject,
  onDismiss,
  onSaveNote,
}: TaskApprovalCardProps) {
  const options = useMemo(() => buildApprovalOptions(), [])

  const handleSelect = useCallback(
    (option: ActionOption) => {
      if (option.key === "A") {
        onApprove(task.id)
      } else if (option.key === "B") {
        onReject(task.id)
      }
    },
    [onApprove, onReject, task.id],
  )

  const owner = agent ? `${agent.name} 的` : ""

  return (
    <ActionCard
      cardId={approvalCardId(task.id)}
      title={`人工审批 · Task #${task.id}`}
      description={`${owner}任务「${task.title}」已完成多 Agent 审阅，等待人工确认后继续最终汇总。`}
      options={canApprove ? options : []}
      variant={variant}
      busy={busy}
      error={error}
      canRespond={canApprove}
      readOnlyHint="该任务正在等待人工审批，仅工作区管理员及以上可操作。"
      noteHint="说明仅本会话可见，接口扩展留待后续批次。"
      initialNote={initialNote}
      onSelect={handleSelect}
      onSubmitNote={(note) => onSaveNote?.(task.id, note)}
      onClose={onDismiss ? () => onDismiss(task.id) : undefined}
      footer={
        <Link
          href={`/tasks/${task.id}`}
          className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
        >
          任务详情
          <ChevronRight aria-hidden="true" className="size-3" />
        </Link>
      }
    />
  )
}

"use client"

import { useEffect, useId, useRef } from "react"
import { AlertTriangle, Loader2, X } from "lucide-react"

import { cn } from "@/lib/utils"

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** destructive 会让确认按钮呈现危险色，并默认聚焦「取消」避免误操作。 */
  tone?: "default" | "destructive"
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 轻量自绘确认弹层（M3 深色风格），替代原生 window.confirm。
 * 支持 Esc 取消、Tab 焦点循环、点击遮罩取消与关闭后焦点还原。
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)

  // 用 ref 保存最新的回调，避免父组件内联函数导致 effect 反复重建
  const onConfirmRef = useRef(onConfirm)
  const onCancelRef = useRef(onCancel)
  const busyRef = useRef(busy)
  useEffect(() => {
    onConfirmRef.current = onConfirm
    onCancelRef.current = onCancel
    busyRef.current = busy
  })

  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return

    lastActiveRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    // 破坏性操作用「取消」承接初始焦点，避免回车误触
    const initialFocus = tone === "destructive" ? cancelRef.current : confirmRef.current
    initialFocus?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        if (!busyRef.current) onCancelRef.current()
        return
      }
      if (event.key !== "Tab") return

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement

      if (!panelRef.current?.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
      lastActiveRef.current?.focus()
    }
  }, [open, tone])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              tone === "destructive"
                ? "bg-destructive/15 text-destructive"
                : "bg-primary/15 text-primary",
            )}
          >
            <AlertTriangle aria-hidden="true" className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-bold text-foreground">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-xs leading-relaxed text-muted-foreground"
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            disabled={busy}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60",
              tone === "destructive"
                ? "bg-destructive text-white hover:opacity-90 focus-visible:ring-destructive"
                : "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary",
            )}
          >
            {busy ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
            {busy ? "处理中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

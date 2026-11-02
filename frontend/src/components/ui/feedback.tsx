import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps {
  title: string
  description?: string
  icon?: ReactNode
  className?: string
}

/** DS-Bot 风格空态：48px 圆底图标 + 13/18 标题 + 13/18 三级说明。 */
export function EmptyState({ title, description, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-3 py-6 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="flex size-12 items-center justify-center rounded-full bg-console-tag text-console-ink-2">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-[13px] leading-[18px] font-medium text-console-ink">{title}</p>
        {description ? (
          <p className="max-w-sm text-[13px] leading-[18px] text-console-ink-3">{description}</p>
        ) : null}
      </div>
    </div>
  )
}

interface SkeletonRowsProps {
  rows?: number
  className?: string
}

/** shimmer 骨架行：12px 圆角条 + 扫描高光（reduced-motion / quiet 下自动停用）。 */
export function SkeletonRows({ rows = 3, className }: SkeletonRowsProps) {
  const widths = ["88%", "72%", "80%", "64%", "76%"]
  return (
    <div className={cn("flex flex-col gap-2.5", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="console-shimmer h-3 rounded-full bg-console-tag"
          style={{ width: widths[index % widths.length] }}
        />
      ))}
    </div>
  )
}

interface ShimmerTextProps {
  children: ReactNode
  className?: string
}

/** 文本 shimmer：background-clip:text 扫描；reduced-motion / quiet 下退化为普通三级文字。 */
export function ShimmerText({ children, className }: ShimmerTextProps) {
  return (
    <span
      className={cn(
        "console-shimmer bg-clip-text text-[13px] leading-[18px] font-medium text-transparent",
        className,
      )}
    >
      {children}
    </span>
  )
}

interface InlineErrorProps {
  message: string
  className?: string
  onRetry?: () => void
}

/** 行内错误：12px danger + role=alert，可选重试按钮（DS-Bot .bt-error 语义）。 */
export function InlineError({ message, className, onRetry }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs text-console-danger",
        className,
      )}
      style={{
        borderColor: "color-mix(in srgb, var(--console-danger) 32%, transparent)",
        background: "color-mix(in srgb, var(--console-danger) 8%, transparent)",
      }}
    >
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium underline underline-offset-2"
        >
          重试
        </button>
      ) : null}
    </div>
  )
}

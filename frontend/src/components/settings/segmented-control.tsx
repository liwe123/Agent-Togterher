"use client"

import { cn } from "@/lib/utils"

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
  /** sm 用于设置页内的紧凑分段，md 用于页面级范围切换 */
  size?: "sm" | "md"
}

/**
 * 分段控件：选中片使用 --console-active 底，等宽 grid 保证滑块与选项精确对齐。
 * 过渡在 prefers-reduced-motion 与 html[data-motion=quiet] 下退化为瞬时。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "md",
}: SegmentedControlProps<T>) {
  const activeIndex = options.findIndex((option) => option.value === value)
  const safeIndex = activeIndex < 0 ? 0 : activeIndex
  const count = Math.max(options.length, 1)

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-grid grid-flow-col auto-cols-fr items-center rounded-full border border-console-line bg-console-surface-2 p-0.5",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-full bg-console-active",
          "transition-transform duration-[var(--console-dur-tap,290ms)] ease-[var(--console-ease-tap,ease)]",
          "motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
        )}
        style={{
          width: `calc((100% - 4px) / ${count})`,
          transform: `translateX(${safeIndex * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 flex min-h-7 items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent focus-visible:ring-offset-1 focus-visible:ring-offset-console-surface",
              size === "sm" ? "px-2.5 text-[11px]" : "px-3 text-xs",
              selected
                ? "text-console-ink"
                : "text-console-ink-3 hover:text-console-ink-2",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

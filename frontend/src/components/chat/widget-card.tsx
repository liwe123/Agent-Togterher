import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "@/components/ui/icons"

import { cn } from "@/lib/utils"

/**
 * 纯展示型 Widget（DS-Bot P1-6 / 分析报告 §3.4）：
 * Metric / DataTable / Progress / Callout 四种，只承载数据不做交互，
 * 因此「不套卡片壳」，由调用方决定放进消息流、动作卡还是面板。
 */

export type WidgetTone = "default" | "good" | "warn" | "bad"

const TONE_VALUE_CLASS: Record<WidgetTone, string> = {
  default: "text-console-ink",
  good: "text-console-success",
  warn: "text-console-warn",
  bad: "text-console-danger",
}

const TONE_BAR_CLASS: Record<WidgetTone, string> = {
  default: "bg-console-accent",
  good: "bg-console-success",
  warn: "bg-console-warn",
  bad: "bg-console-danger",
}

const CALLOUT_CLASS: Record<WidgetTone, string> = {
  default:
    "bg-[color-mix(in_srgb,var(--console-ink)_6%,transparent)] text-console-ink-2",
  good:
    "bg-[color-mix(in_srgb,var(--console-success)_10%,transparent)] text-console-ink",
  warn:
    "bg-[color-mix(in_srgb,var(--console-warn)_12%,transparent)] text-console-ink",
  bad:
    "bg-[color-mix(in_srgb,var(--console-danger)_10%,transparent)] text-console-ink",
}

const CALLOUT_ICON_CLASS: Record<WidgetTone, string> = {
  default: "text-console-ink-3",
  good: "text-console-success",
  warn: "text-console-warn",
  bad: "text-console-danger",
}

const CALLOUT_ICONS: Record<WidgetTone, ReactNode> = {
  default: <Info aria-hidden="true" className="size-4" />,
  good: <CheckCircle2 aria-hidden="true" className="size-4" />,
  warn: <AlertTriangle aria-hidden="true" className="size-4" />,
  bad: <CircleAlert aria-hidden="true" className="size-4" />,
}

export interface WidgetMetricProps {
  label: string
  value: ReactNode
  tone?: WidgetTone
  hint?: string
  className?: string
}

/** 指标：12/16 label + 22/28 600 数值 + tone 色（DS-Bot metric 规格）。 */
export function WidgetMetric({
  label,
  value,
  tone = "default",
  hint,
  className,
}: WidgetMetricProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-[12px] leading-4 text-console-ink-3">{label}</span>
      <span
        className={cn(
          "text-[22px] leading-7 font-semibold console-tabular",
          TONE_VALUE_CLASS[tone],
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-[11px] leading-4 text-console-ink-3">{hint}</span>
      ) : null}
    </div>
  )
}

export interface WidgetTableColumn {
  key: string
  label: string
  align?: "left" | "right"
}

export interface WidgetDataTableProps {
  columns: WidgetTableColumn[]
  rows: Array<Record<string, ReactNode>>
  caption?: string
  className?: string
}

/** 数据表：0.5px 外框 + 圆角 10，数字列右对齐 + tabular。 */
export function WidgetDataTable({
  columns,
  rows,
  caption,
  className,
}: WidgetDataTableProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-console-md border-[0.5px] border-console-line",
        className,
      )}
    >
      <table className="w-full border-collapse text-[13px] leading-[18px]">
        {caption ? (
          <caption className="px-2.5 py-1.5 text-left text-[11px] leading-4 text-console-ink-3">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr className="bg-console-tag">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-2.5 py-1.5 text-[12px] font-medium text-console-ink-3",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-2.5 py-2 text-center text-[12px] text-console-ink-3"
              >
                暂无数据
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-t-[0.5px] border-console-line"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-2.5 py-1.5 text-console-ink",
                      column.align === "right" && "text-right console-tabular",
                    )}
                  >
                    {row[column.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export interface WidgetProgressProps {
  label: string
  value: number
  max?: number
  tone?: WidgetTone
  hint?: string
  className?: string
}

/** 进度：6px 轨道 + accent/tone 填充。 */
export function WidgetProgress({
  label,
  value,
  max = 100,
  tone = "default",
  hint,
  className,
}: WidgetProgressProps) {
  const percent =
    max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] leading-4 text-console-ink-3">{label}</span>
        <span className="text-[12px] leading-4 text-console-ink-2 console-tabular">
          {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-console-tag"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-[var(--console-dur-shape,326ms)] ease-[var(--console-ease-shape,ease)] motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none",
            TONE_BAR_CLASS[tone],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hint ? (
        <span className="text-[11px] leading-4 text-console-ink-3">{hint}</span>
      ) : null}
    </div>
  )
}

export interface WidgetCalloutProps {
  tone?: WidgetTone
  title?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/** 提示块：tone 8~12% 极淡底 + 16px 图标。 */
export function WidgetCallout({
  tone = "default",
  title,
  icon,
  children,
  className,
}: WidgetCalloutProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-console-md px-3 py-2.5 text-[13px] leading-[18px]",
        CALLOUT_CLASS[tone],
        className,
      )}
    >
      <span className={cn("mt-0.5 shrink-0", CALLOUT_ICON_CLASS[tone])}>
        {icon ?? CALLOUT_ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title ? (
          <p className="font-medium text-console-ink">{title}</p>
        ) : null}
        <div className="text-console-ink-2">{children}</div>
      </div>
    </div>
  )
}

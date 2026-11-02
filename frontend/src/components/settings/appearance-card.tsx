"use client"

import { Check } from "@/components/ui/icons"

import { SegmentedControl } from "@/components/settings/segmented-control"
import { useAppearance } from "@/hooks/use-appearance"
import { cn } from "@/lib/utils"

type ThemeId = "deepseek" | "mono" | "paper" | "moonlight"

interface ThemePreset {
  id: ThemeId
  label: string
  /** 浅色档背景 */
  lightBg: string
  /** 深色档背景 */
  darkBg: string
  /** 浅色档强调色 */
  lightAccent: string
  /** 深色档强调色 */
  darkAccent: string
}

/* 主题预览色与 globals.css 的 8 颜色键同源，仅用于 46×30 缩略图 */
const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "deepseek",
    label: "深灰蓝",
    lightBg: "#fcfcfc",
    darkBg: "#141414",
    lightAccent: "#4d6bfe",
    darkAccent: "#5b7bff",
  },
  {
    id: "mono",
    label: "黑白",
    lightBg: "#ffffff",
    darkBg: "#0f0f0f",
    lightAccent: "#0d0d0d",
    darkAccent: "#f4f4f4",
  },
  {
    id: "paper",
    label: "纸感",
    lightBg: "#faf9f5",
    darkBg: "#1f1e1b",
    lightAccent: "#d97757",
    darkAccent: "#e08a6d",
  },
  {
    id: "moonlight",
    label: "月夜",
    lightBg: "#f7f9fc",
    darkBg: "#0b1020",
    lightAccent: "#1e86ff",
    darkAccent: "#4f9dff",
  },
] as const

interface AccentPreset {
  /** 主题默认为 null；其余为 DS-Bot ink id */
  id: string | null
  label: string
  hex: string | null
}

const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: null, label: "主题默认", hex: null },
  { id: "deepseek", label: "DeepSeek 蓝", hex: "#4d6bfe" },
  { id: "charcoal", label: "炭黑", hex: "#333333" },
  { id: "graphite", label: "石墨", hex: "#666666" },
  { id: "rose", label: "玫瑰", hex: "#e5707e" },
  { id: "sky", label: "天蓝", hex: "#5aa7ff" },
  { id: "tangerine", label: "橘红", hex: "#d97757" },
  { id: "cobalt", label: "钴蓝", hex: "#3155d6" },
] as const

const MODE_OPTIONS = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
] as const

const MOTION_OPTIONS = [
  { value: "quiet", label: "安静" },
  { value: "normal", label: "正常" },
  { value: "lively", label: "灵动" },
] as const

const ACCENT_TRANSITION =
  "transition-all duration-[var(--console-dur-list,190ms)] ease-[var(--console-ease-list,ease)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"

/**
 * 外观设置卡：主题 / 模式 / 强调色 / 动效档位。
 * 纯前端偏好，写入由 useAppearance 负责（documentElement + localStorage），改动即时生效。
 */
export function AppearanceCard() {
  const {
    themeId,
    setThemeId,
    accent,
    setAccent,
    mode,
    setMode,
    motion,
    setMotion,
  } = useAppearance()

  const normalizedAccent = accent?.toLowerCase() ?? null
  const currentAccent =
    ACCENT_PRESETS.find((preset) =>
      preset.hex === null
        ? normalizedAccent === null
        : preset.id === normalizedAccent || preset.hex === normalizedAccent,
    ) ?? null
  const accentLabel = currentAccent?.label ?? normalizedAccent ?? "主题默认"

  return (
    <div className="console-card overflow-hidden">
      <div className="divide-y divide-console-line [&>*:first-child]:rounded-t-[12px] [&>*:last-child]:rounded-b-[12px]">
        {/* 主题 */}
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[13px] leading-[18px] text-console-ink">主题</p>
            <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
              四套主题色板，随明暗模式自动切换浅色 / 深色档
            </p>
          </div>
          <div
            role="group"
            aria-label="主题"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {THEME_PRESETS.map((theme) => {
              const selected = themeId === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`主题：${theme.label}`}
                  onClick={() => setThemeId(theme.id)}
                  className={cn(
                    "group flex flex-col items-center gap-2 rounded-[10px] border p-2",
                    ACCENT_TRANSITION,
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent focus-visible:ring-offset-1 focus-visible:ring-offset-console-surface",
                    selected
                      ? "border-console-accent bg-console-active"
                      : "border-console-line bg-console-surface-2 hover:bg-console-hover",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="relative flex h-[30px] w-[46px] overflow-hidden rounded-[6px] border border-console-line"
                  >
                    <span
                      className="h-full w-1/2"
                      style={{ backgroundColor: theme.lightBg }}
                    />
                    <span
                      className="h-full w-1/2"
                      style={{ backgroundColor: theme.darkBg }}
                    />
                    <span
                      className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/20"
                      style={{ backgroundColor: theme.lightAccent }}
                    />
                  </span>
                  <span className="flex items-center gap-1 text-[13px] leading-5 text-console-ink">
                    {theme.label}
                    {selected ? (
                      <Check
                        aria-hidden="true"
                        className="size-3 text-console-accent"
                      />
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 模式 */}
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] leading-[18px] text-console-ink">模式</p>
            <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
              深色与浅色共享同一套语义令牌，切换不改变布局
            </p>
          </div>
          <SegmentedControl
            ariaLabel="明暗模式"
            options={MODE_OPTIONS}
            value={mode}
            onChange={(next) => setMode(next)}
            size="sm"
            className="shrink-0 self-start sm:self-auto"
          />
        </div>

        {/* 强调色 */}
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] leading-[18px] text-console-ink">强调色</p>
            <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
              按钮、链接与选中态使用强调色，前景色按对比度自动推导
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1.5 self-start sm:items-end sm:self-auto">
            <div role="group" aria-label="强调色" className="flex items-center gap-2">
              {ACCENT_PRESETS.map((preset) => {
                const selected =
                  preset.id === null
                    ? normalizedAccent === null
                    : preset.id === normalizedAccent ||
                      preset.hex === normalizedAccent
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={selected}
                    aria-label={preset.label}
                    title={preset.label}
                    onClick={() =>
                      setAccent(preset.id === null ? null : preset.id)
                    }
                    className={cn(
                      "relative flex size-7 items-center justify-center rounded-full border",
                      ACCENT_TRANSITION,
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent focus-visible:ring-offset-1 focus-visible:ring-offset-console-surface",
                      selected
                        ? "border-console-accent ring-2 ring-console-accent/35"
                        : "border-console-line-2 hover:scale-105 hover:border-console-line",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="size-[18px] rounded-full ring-1 ring-black/10"
                      style={{
                        background:
                          preset.hex === null
                            ? "linear-gradient(135deg, var(--console-accent) 0 50%, var(--console-surface-2) 50% 100%)"
                            : preset.hex,
                      }}
                    />
                    {selected ? (
                      <Check
                        aria-hidden="true"
                        className="absolute size-3 text-console-accent drop-shadow-[0_0_2px_var(--console-surface)]"
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
            <p className="console-meta">当前：{accentLabel}</p>
          </div>
        </div>

        {/* 动效 */}
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[13px] leading-[18px] text-console-ink">动效</p>
              <p className="mt-0.5 text-xs leading-4 text-console-ink-3">
                安静（quiet）只保留状态变化，正常（normal）平衡过渡，灵动（lively）增加待机动画
              </p>
            </div>
            <SegmentedControl
              ariaLabel="动效档位"
              options={MOTION_OPTIONS}
              value={motion}
              onChange={(next) => setMotion(next)}
              size="sm"
              className="shrink-0 self-start sm:self-auto"
            />
          </div>
          <p className="console-meta">
            系统「减少动态效果」设置始终优先；安静档下过渡时长趋近 0，仅保留透明度变化。
          </p>
        </div>
      </div>
    </div>
  )
}

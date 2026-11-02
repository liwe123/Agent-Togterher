/**
 * DS-Bot 主题与强调色令牌的 TypeScript 事实源（PRD FR1/FR2）。
 * 颜色键与 `client.js:1769-1790` 的四套主题逐值一致；
 * 强调色 ink 表与 `client.js:1351-1373` 的 INKS / ACCENT_INKS 一致。
 * 纯函数，供 hooks/use-appearance 与单元测试消费。
 */

export type ThemeId = "deepseek" | "mono" | "paper" | "moonlight"
export type ColorMode = "dark" | "light"
export type MotionLevel = "quiet" | "normal" | "lively"

export interface ThemeColors {
  bg: string
  sidebar: string
  bubble: string
  card: string
  text: string
  user: string
  userText: string
  accent: string
}

export interface ThemePreset {
  id: ThemeId
  label: string
  description: string
  light: ThemeColors
  dark: ThemeColors
}

export interface AccentPreset {
  id: string
  label: string
  light: string
  dark: string
}

export const THEMES: readonly ThemePreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "深灰蓝 · 默认强调色",
    light: {
      bg: "#fcfcfc", sidebar: "#f7f7f7", bubble: "#eeeeee", card: "#ffffff",
      text: "#141414", user: "#070707", userText: "#fcfcfc", accent: "#4d6bfe",
    },
    dark: {
      bg: "#141414", sidebar: "#1b1b1b", bubble: "#262626", card: "#1f1f1f",
      text: "#f2f2f2", user: "#f2f2f2", userText: "#141414", accent: "#5b7bff",
    },
  },
  {
    id: "mono",
    label: "Mono",
    description: "黑白极简 · 无彩色强调",
    light: {
      bg: "#ffffff", sidebar: "#f9f9f9", bubble: "#f0f0f0", card: "#ffffff",
      text: "#0d0d0d", user: "#0d0d0d", userText: "#ffffff", accent: "#0d0d0d",
    },
    dark: {
      bg: "#0f0f0f", sidebar: "#171717", bubble: "#242424", card: "#1c1c1c",
      text: "#f4f4f4", user: "#f4f4f4", userText: "#0f0f0f", accent: "#f4f4f4",
    },
  },
  {
    id: "paper",
    label: "Paper",
    description: "纸感暖色 · 低对比柔和",
    light: {
      bg: "#faf9f5", sidebar: "#f3f0e8", bubble: "#ebe7dc", card: "#ffffff",
      text: "#1f1e1b", user: "#2b2a26", userText: "#faf9f5", accent: "#d97757",
    },
    dark: {
      bg: "#1f1e1b", sidebar: "#262521", bubble: "#34322d", card: "#2a2925",
      text: "#f3f0e8", user: "#f3f0e8", userText: "#1f1e1b", accent: "#e08a6d",
    },
  },
  {
    id: "moonlight",
    label: "Moonlight",
    description: "深夜蓝紫 · 高饱和强调",
    light: {
      bg: "#f7f9fc", sidebar: "#eef2f8", bubble: "#e5ebf5", card: "#ffffff",
      text: "#121826", user: "#1e3a8a", userText: "#ffffff", accent: "#1e86ff",
    },
    dark: {
      bg: "#0b1020", sidebar: "#10172a", bubble: "#1a2340", card: "#141c33",
      text: "#e8edf7", user: "#3b6fd8", userText: "#ffffff", accent: "#4f9dff",
    },
  },
] as const

/** 强调色预设（DS-Bot ACCENT_INKS 七色，[light, dark]）。 */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: "deepseek", label: "DeepSeek 蓝", light: "#4D6BFE", dark: "#6A84FF" },
  { id: "charcoal", label: "炭黑", light: "#141416", dark: "#F1F2F4" },
  { id: "graphite", label: "石墨", light: "#2D2D2D", dark: "#D6D6DA" },
  { id: "rose", label: "玫瑰", light: "#EC2F6B", dark: "#FF5A7A" },
  { id: "sky", label: "天青", light: "#0AA8D6", dark: "#2EE6E0" },
  { id: "tangerine", label: "蜜橘", light: "#FF6900", dark: "#FF8A2E" },
  { id: "cobalt", label: "钴蓝", light: "#082DFF", dark: "#5C78FF" },
] as const

/** DS-Bot 全部 19 个 ink（角色名着色/图表系列/强调色扩展用），[light, dark]。 */
export const INKS: Readonly<Record<string, readonly [string, string]>> = {
  deepseek: ["#4D6BFE", "#6A84FF"],
  charcoal: ["#141416", "#F1F2F4"],
  graphite: ["#2D2D2D", "#D6D6DA"],
  rose: ["#EC2F6B", "#FF5A7A"],
  sky: ["#0AA8D6", "#2EE6E0"],
  tangerine: ["#FF6900", "#FF8A2E"],
  cobalt: ["#082DFF", "#5C78FF"],
  black: ["#000000", "#FFFFFF"],
  brown: ["#A27952", "#855C36"],
  red: ["#FF3E51", "#E02135"],
  orange: ["#FF781C", "#FF6700"],
  yellow: ["#FFAF38", "#FF9800"],
  green: ["#00C972", "#009957"],
  cyan: ["#1CC3B0", "#00A592"],
  blue: ["#2A92FE", "#0E74E0"],
  violet: ["#A97EFE", "#804EE0"],
  magenta: ["#FF5EB1", "#E02A88"],
  gray: ["#959595", "#777777"],
  aurora: ["#00B8D4", "#2EE6E0"],
}

export const DEFAULT_THEME: ThemeId = "deepseek"
export const DEFAULT_MODE: ColorMode = "dark"
export const DEFAULT_MOTION: MotionLevel = "normal"
export const DARK_INK = "#141414"

export const STORAGE_KEYS = {
  theme: "console.theme",
  accent: "console.accent",
  mode: "console.mode",
  motion: "console.motion",
  panelWidth: "console.panelW",
} as const

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id))
const MOTION_LEVELS = new Set<string>(["quiet", "normal", "lively"])

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_IDS.has(value)
}

export function isColorMode(value: unknown): value is ColorMode {
  return value === "dark" || value === "light"
}

export function isMotionLevel(value: unknown): value is MotionLevel {
  return typeof value === "string" && MOTION_LEVELS.has(value)
}

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
}

/** WCAG 相对亮度（与 DS-Bot client.js:1376 一致）。 */
export function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
  )
  return channels
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, channel, index) =>
        sum + channel * [0.2126, 0.7152, 0.0722][index],
      0,
    )
}

/** accent 前景色推导（DS-Bot client.js:1792 的平方亮度比阈值）。 */
export function accentInk(accent: string): string {
  return (luminance(accent) + 0.05) ** 2 > 1.05 * (luminance(DARK_INK) + 0.05)
    ? DARK_INK
    : "#ffffff"
}

/** 若传入的是某个强调色预设的浅色值，深色模式下返回该预设的深色值。 */
export function darkAccent(accent: string | null): string | null {
  if (accent === null) return null
  const preset = ACCENT_PRESETS.find((item) => item.light === accent)
  return preset ? preset.dark : accent
}

export function accentPreset(id: string): AccentPreset | undefined {
  return ACCENT_PRESETS.find((preset) => preset.id === id)
}

export function themePreset(id: ThemeId): ThemePreset {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]
}

export function themeColors(themeId: ThemeId, mode: ColorMode): ThemeColors {
  return themePreset(themeId)[mode]
}

/**
 * 解析最终强调色：
 * - null → 主题默认；
 * - 预设 id → 对应明暗档位；
 * - #rrggbb → 深色模式下按 darkAccent 做预设映射，其余原样。
 */
export function resolveAccent(
  themeId: ThemeId,
  mode: ColorMode,
  accent: string | null,
): string {
  const colors = themeColors(themeId, mode)
  if (accent === null || accent === "default") return colors.accent
  const preset = accentPreset(accent)
  if (preset) return mode === "dark" ? preset.dark : preset.light
  if (isHex(accent)) {
    return mode === "dark" ? darkAccent(accent) ?? accent : accent
  }
  return colors.accent
}

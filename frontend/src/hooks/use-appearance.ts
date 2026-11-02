"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"

import {
  DEFAULT_MODE,
  DEFAULT_MOTION,
  DEFAULT_THEME,
  STORAGE_KEYS,
  accentInk,
  isColorMode,
  isMotionLevel,
  isThemeId,
  resolveAccent,
  type ColorMode,
  type MotionLevel,
  type ThemeId,
} from "@/lib/design-tokens"

export interface AppearanceState {
  themeId: ThemeId
  /** null = 主题默认强调色；否则为预设 id 或 #rrggbb。 */
  accent: string | null
  mode: ColorMode
  motion: MotionLevel
}

const DEFAULTS: AppearanceState = {
  themeId: DEFAULT_THEME,
  accent: null,
  mode: DEFAULT_MODE,
  motion: DEFAULT_MOTION,
}

let cached: AppearanceState | null = null
const listeners = new Set<() => void>()

function readStorage(): AppearanceState {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const storage = window.localStorage
    const themeId = storage.getItem(STORAGE_KEYS.theme)
    const mode = storage.getItem(STORAGE_KEYS.mode)
    const motion = storage.getItem(STORAGE_KEYS.motion)
    const accent = storage.getItem(STORAGE_KEYS.accent)
    return {
      themeId: isThemeId(themeId) ? themeId : DEFAULTS.themeId,
      mode: isColorMode(mode) ? mode : DEFAULTS.mode,
      motion: isMotionLevel(motion) ? motion : DEFAULTS.motion,
      accent: accent && accent.length > 0 ? accent : null,
    }
  } catch {
    return DEFAULTS
  }
}

function persist(state: AppearanceState) {
  if (typeof window === "undefined") return
  try {
    const storage = window.localStorage
    storage.setItem(STORAGE_KEYS.theme, state.themeId)
    storage.setItem(STORAGE_KEYS.mode, state.mode)
    storage.setItem(STORAGE_KEYS.motion, state.motion)
    if (state.accent === null) {
      storage.removeItem(STORAGE_KEYS.accent)
    } else {
      storage.setItem(STORAGE_KEYS.accent, state.accent)
    }
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级为会话内生效
  }
}

/** 把外观偏好写到 <html>：data-theme / data-motion / dark class / accent 变量。 */
export function applyAppearance(state: AppearanceState) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.theme = state.themeId
  root.dataset.motion = state.motion
  root.classList.toggle("dark", state.mode === "dark")
  if (state.accent === null) {
    root.style.removeProperty("--t-accent")
    root.style.removeProperty("--t-accent-ink")
    return
  }
  const accent = resolveAccent(state.themeId, state.mode, state.accent)
  root.style.setProperty("--t-accent", accent)
  root.style.setProperty("--t-accent-ink", accentInk(accent))
}

export function getAppearance(): AppearanceState {
  if (typeof window === "undefined") return DEFAULTS
  if (cached === null) cached = readStorage()
  return cached
}

function commit(next: AppearanceState) {
  cached = next
  persist(next)
  applyAppearance(next)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getServerSnapshot(): AppearanceState {
  return DEFAULTS
}

export function useAppearance() {
  const state = useSyncExternalStore(subscribe, getAppearance, getServerSnapshot)

  // 首帧后把持久化偏好同步到 <html>（外部系统副作用，不涉及 React state）。
  useEffect(() => {
    applyAppearance(getAppearance())
  }, [])

  const setThemeId = useCallback((themeId: ThemeId) => {
    commit({ ...getAppearance(), themeId })
  }, [])

  const setAccent = useCallback((accent: string | null) => {
    commit({ ...getAppearance(), accent })
  }, [])

  const setMode = useCallback((mode: ColorMode) => {
    commit({ ...getAppearance(), mode })
  }, [])

  const setMotion = useCallback((motion: MotionLevel) => {
    commit({ ...getAppearance(), motion })
  }, [])

  return {
    themeId: state.themeId,
    accent: state.accent,
    mode: state.mode,
    motion: state.motion,
    setThemeId,
    setAccent,
    setMode,
    setMotion,
  }
}

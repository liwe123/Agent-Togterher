"use client"

import type { ReactNode } from "react"

import { CommandPalette } from "@/components/console/command-palette"
import { useAppearance } from "@/hooks/use-appearance"

/**
 * 全局客户端 Provider（PRD FR2/FR6）：
 * - 挂载外观偏好（主题/模式/强调色/动效档位）并写入 <html>；
 * - 挂载全局命令面板（Ctrl/Cmd+K，自带全局快捷键监听）。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  useAppearance()
  return (
    <>
      {children}
      <CommandPalette />
    </>
  )
}

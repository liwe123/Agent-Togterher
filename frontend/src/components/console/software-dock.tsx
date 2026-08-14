"use client"

import {
  Bot,
  Braces,
  CodeXml,
  MousePointer2,
  Sparkles,
  Workflow,
} from "lucide-react"
import type { CSSProperties } from "react"
import { useState } from "react"

const software = [
  { name: "TRAE Work CN", icon: Workflow, tone: 1, port: "接入位 1" },
  { name: "TRAE CN Solo", icon: Bot, tone: 4, port: "接入位 2" },
  { name: "Antigravity 2.0", icon: Sparkles, tone: 3, port: "接入位 3" },
  { name: "Codex", icon: Braces, tone: 2, port: "接入位 4" },
  { name: "Cursor", icon: MousePointer2, tone: 6, port: "接入位 5" },
  { name: "Claude", icon: CodeXml, tone: 5, port: "接入位 6" },
]

export function SoftwareDock() {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const selectedSoftware = software.find((item) => item.name === selectedName)

  return (
    <section aria-labelledby="software-dock" className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 p-5 sm:p-6 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Workflow aria-hidden="true" className="size-4.5" />
          </span>
          <div>
            <h2 id="software-dock" className="text-base font-semibold tracking-tight text-foreground">软件 Dock</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">点击端口入口查看连接状态</p>
          </div>
        </div>
        <span className="hidden rounded-full border border-border/60 bg-secondary/40 px-3 py-1 text-xs text-muted-foreground sm:block">
          6 个调试端口已登记
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3.5 sm:grid-cols-6">
        {software.map((item) => {
          const Icon = item.icon
          const isSelected = selectedName === item.name
          return (
            <button
              key={item.name}
              type="button"
              aria-pressed={isSelected}
              aria-label={`查看 ${item.name} 连接状态`}
              onClick={() => setSelectedName((current) => current === item.name ? null : item.name)}
              className="group flex min-w-0 flex-col items-center gap-2.5 rounded-2xl p-2 text-center transition-all duration-200 hover:bg-secondary/60 active:scale-95"
              style={{ "--tool-tone": `var(--avatar-${item.tone})` } as CSSProperties}
            >
              <span className="tool-launcher relative flex size-14 items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--tool-tone)_45%,var(--border))] bg-[color-mix(in_oklch,var(--tool-tone)_18%,var(--card))] text-[var(--tool-tone)] transition-transform duration-200 ease-out group-hover:-translate-y-0.5 sm:size-16">
                <Icon aria-hidden="true" className="size-6 sm:size-7" />
                <span className="absolute -bottom-1 size-2.5 rounded-full border-2 border-card bg-[var(--status-running)] shadow-[0_0_4px_var(--status-running)]" aria-hidden="true" />
              </span>
              <span className="w-full truncate text-[11px] font-medium text-foreground sm:text-xs">{item.name}</span>
            </button>
          )
        })}
      </div>

      {selectedSoftware ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-5 py-3.5 text-xs shadow-sm" aria-live="polite">
          <div>
            <p className="font-semibold text-foreground">{selectedSoftware.name}</p>
            <p className="mt-0.5 text-muted-foreground">{selectedSoftware.port} · 调试通道已登记</p>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-primary/20 px-3 py-1 font-medium text-primary">
            <span className="status-dot size-2 rounded-full" data-status="online" aria-hidden="true" />
            当前在线
          </span>
        </div>
      ) : null}
    </section>
  )
}

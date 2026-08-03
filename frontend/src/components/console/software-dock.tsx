import {
  Bot,
  Braces,
  CodeXml,
  MousePointer2,
  Sparkles,
  Workflow,
} from "lucide-react"
import type { CSSProperties } from "react"

const software = [
  { name: "TRAE Work CN", icon: Workflow, tone: 1 },
  { name: "TRAE CN Solo", icon: Bot, tone: 4 },
  { name: "Antigravity 2.0", icon: Sparkles, tone: 3 },
  { name: "Codex", icon: Braces, tone: 2 },
  { name: "Cursor", icon: MousePointer2, tone: 6 },
  { name: "Claude", icon: CodeXml, tone: 5 },
]

export function SoftwareDock() {
  return (
    <section aria-labelledby="software-dock" className="console-panel overflow-hidden rounded-2xl border border-border bg-card/82 p-4 sm:p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
            <Workflow aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h2 id="software-dock" className="text-base font-semibold tracking-tight">软件 Dock</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">点击入口查看连接状态</p>
          </div>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">6 个调试端口已登记</span>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {software.map((item, index) => {
          const Icon = item.icon
          return (
            <div
              key={item.name}
              title={`${item.name} · 接入位 ${index + 1}`}
              className="group flex min-w-0 flex-col items-center gap-3 rounded-xl px-1 py-2 text-center transition-colors hover:bg-muted/35"
              style={{ "--tool-tone": `var(--avatar-${item.tone})` } as CSSProperties}
            >
              <span className="tool-launcher relative flex size-14 items-center justify-center rounded-2xl border border-[color-mix(in_oklch,var(--tool-tone)_45%,var(--border))] bg-[color-mix(in_oklch,var(--tool-tone)_16%,var(--card))] text-[var(--tool-tone)] transition-transform duration-200 ease-out group-hover:-translate-y-0.5 sm:size-16">
                <Icon aria-hidden="true" className="size-6 sm:size-7" />
                <span className="absolute -bottom-1 size-2 rounded-full border-2 border-card bg-[var(--status-running)]" aria-hidden="true" />
              </span>
              <span className="w-full truncate text-[11px] font-medium text-foreground sm:text-xs">{item.name}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

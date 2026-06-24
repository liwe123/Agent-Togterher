import {
  Bot,
  Braces,
  CodeXml,
  MousePointer2,
  Sparkles,
  Workflow,
} from "lucide-react"

const software = [
  { name: "TRAE Work", icon: Workflow },
  { name: "TRAE Solo", icon: Bot },
  { name: "Codex", icon: Braces },
  { name: "Cursor", icon: MousePointer2 },
  { name: "Claude", icon: CodeXml },
  { name: "Gemini", icon: Sparkles },
]

export function SoftwareDock() {
  return (
    <section aria-labelledby="software-dock" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="software-dock" className="text-base font-semibold tracking-tight">
            工具接入
          </h2>
          <p className="text-xs text-muted-foreground">已规划的开发工具入口，当前仅展示接入位</p>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">06 PORTS</span>
      </div>

      <div className="console-panel grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card/70 sm:grid-cols-3 xl:grid-cols-6">
        {software.map((item, index) => {
          const Icon = item.icon
          return (
            <div
              key={item.name}
              className="group flex min-h-24 flex-col justify-between gap-4 border-r border-b border-border/75 p-3.5 transition-colors hover:bg-muted/45 xl:border-b-0"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="section-mark flex size-8 items-center justify-center rounded-md">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">P{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="flex items-end justify-between gap-2">
                <span className="truncate text-sm font-medium">{item.name}</span>
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/55" aria-label="待接入" />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

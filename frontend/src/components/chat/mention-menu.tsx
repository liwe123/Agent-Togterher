import { useEffect, useRef } from "react"
import { Activity, Circle } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { MentionEntry } from "@/lib/mention-utils"

export type { MentionEntry } from "@/lib/mention-utils"

interface MentionMenuProps {
  items: MentionEntry[]
  activeIndex: number
  onSelect: (entry: MentionEntry) => void
}

export function MentionMenu({ items, activeIndex, onSelect }: MentionMenuProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    const el = itemRefs.current[activeIndex]
    if (el) {
      el.scrollIntoView({ block: "nearest" })
    }
  }, [activeIndex])

  return (
    <div
      role="listbox"
      aria-label="选择可 @ 的角色"
      className="absolute right-0 bottom-[calc(100%+0.5rem)] left-0 z-50 overflow-hidden rounded-3xl border border-border/80 bg-popover/95 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl sm:right-auto sm:w-88 animate-in zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 mb-1">
        <p className="text-[11px] font-semibold text-primary">
          选择可 @ 的角色
        </p>
        <span className="text-[10px] text-muted-foreground font-mono">
          {items.length} 位可选
        </span>
      </div>
      <div className="scrollbar-thin max-h-64 overflow-y-auto space-y-1">
        {items.map((entry, index) => {
          const isIntegration = entry.kind === "integration"
          const isActive = entry.status === "running" || (isIntegration && entry.status === "busy")
          const isError =
            entry.status === "failed" ||
            entry.status === "error" ||
            entry.status === "offline"
          return (
            <button
              key={entry.key}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(entry)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all duration-150",
                index === activeIndex
                  ? "bg-primary/20 text-primary font-medium shadow-sm"
                  : "hover:bg-secondary/70 text-foreground",
              )}
            >
              <Avatar size="sm" className="agent-avatar rounded-full shrink-0" data-tone={index % 6}>
                <AvatarFallback className="rounded-full">
                  {entry.avatar ?? entry.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="block truncate text-xs font-semibold">@{entry.name}</span>
                  {entry.roleLabel && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                      {entry.roleLabel}
                    </span>
                  )}
                  {isIntegration && (
                    <span className="shrink-0 rounded-full bg-secondary/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                      外部节点
                    </span>
                  )}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground font-mono">
                  {isIntegration ? `提供方: ${entry.subtitle}` : `模型: ${entry.subtitle}`}
                </span>
              </span>
              {isActive ? (
                <Activity
                  aria-label={isIntegration ? "工作中" : "工作中"}
                  className="size-3.5 text-[var(--status-running)] animate-pulse shrink-0"
                />
              ) : (
                <Circle
                  aria-label={isError ? "异常" : "空闲"}
                  className={cn(
                    "size-2.5 shrink-0",
                    isError
                      ? "fill-destructive text-destructive"
                      : "fill-[var(--status-idle)] text-[var(--status-idle)]",
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

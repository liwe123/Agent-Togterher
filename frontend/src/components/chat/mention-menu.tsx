import { Activity, Circle } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

interface MentionMenuProps {
  agents: Agent[]
  activeIndex: number
  onSelect: (agent: Agent) => void
}

export function MentionMenu({
  agents,
  activeIndex,
  onSelect,
}: MentionMenuProps) {
  return (
    <div
      role="listbox"
      aria-label="选择要提及的 Agent"
      className="absolute right-0 bottom-[calc(100%+0.5rem)] left-0 z-20 overflow-hidden rounded-3xl border border-border/80 bg-popover/95 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl sm:right-auto sm:w-80 animate-in zoom-in-95 duration-150"
    >
      <p className="px-3 py-1.5 text-[11px] font-semibold text-primary">
        选择提及 Agent
      </p>
      <div className="scrollbar-thin max-h-64 overflow-y-auto space-y-1">
        {agents.map((agent, index) => (
          <button
            key={agent.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(agent)}
            className={cn(
              "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all duration-150",
              index === activeIndex
                ? "bg-primary/20 text-primary font-medium shadow-sm"
                : "hover:bg-secondary/70 text-foreground",
            )}
          >
            <Avatar size="sm" className="agent-avatar rounded-full" data-tone={index % 6}>
              <AvatarFallback className="rounded-full">{agent.avatar ?? agent.name.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">@{agent.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground font-mono">
                {agent.model_name}
              </span>
            </span>
            {agent.status === "running" ? (
              <Activity aria-label="工作中" className="size-3.5 text-[var(--status-running)] animate-pulse" />
            ) : (
              <Circle
                aria-label={agent.status === "failed" ? "失败" : "空闲"}
                className={cn(
                  "size-2.5",
                  agent.status === "failed"
                    ? "fill-destructive text-destructive"
                    : "fill-[var(--status-idle)] text-[var(--status-idle)]",
                )}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

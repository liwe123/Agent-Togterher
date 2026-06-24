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
      className="absolute right-0 bottom-[calc(100%+0.5rem)] left-0 z-20 overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg sm:right-auto sm:w-80"
    >
      <p className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
        选择 Agent
      </p>
      <div className="scrollbar-thin max-h-64 overflow-y-auto">
        {agents.map((agent, index) => (
          <button
            key={agent.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(agent)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
              index === activeIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted/70",
            )}
          >
            <Avatar size="sm" className="agent-avatar" data-tone={index % 6}>
              <AvatarFallback>{agent.avatar ?? agent.name.slice(0, 2)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">@{agent.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {agent.model_name}
              </span>
            </span>
            {agent.status === "running" ? (
              <Activity aria-label="工作中" className="size-3.5 text-[var(--status-running)]" />
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

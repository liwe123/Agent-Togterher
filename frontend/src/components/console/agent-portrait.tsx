import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

const fallbackPortraits: Record<string, string> = {
  project_architect: "🧑🏽‍💼",
  agent_engineer: "🧑🏾‍💻",
  frontend_designer: "🧑🏽‍🎨",
  knowledge_manager: "🧑🏻‍🏫",
  qa_engineer: "🧑🏻‍🔬",
  operations_engineer: "🧑🏿‍🔧",
}

interface AgentPortraitProps {
  agent: Agent
  index: number
  size?: "sm" | "md" | "lg"
  onClick?: () => void
  className?: string
}

export function AgentPortrait({
  agent,
  index,
  size = "md",
  onClick,
  className,
}: AgentPortraitProps) {
  return (
    <span
      className={cn(
        "agent-portrait shrink-0",
        size === "sm" && "size-14! text-3xl",
        size === "md" && "text-[2.45rem]",
        size === "lg" && "size-24! text-5xl",
        className,
      )}
      data-tone={index % 6}
      data-status={agent.status}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={`${agent.name}，${agent.status === "running" ? "工作中" : agent.status === "failed" ? "失败" : "空闲"}`}
    >
      <span aria-hidden="true" className="translate-y-0.5 select-none">
        {agent.avatar ?? fallbackPortraits[agent.role] ?? "🤖"}
      </span>
      <span
        className="status-dot absolute right-0 bottom-1 size-2.5 rounded-full border-2 border-card"
        data-status={agent.status}
        aria-hidden="true"
      />
    </span>
  )
}

import { BotMark, type BotMarkState } from "@/components/console/bot-mark"
import { agentStatusLabel } from "@/components/console/agent-meta"
import { botShapeForRole } from "@/lib/bot-shapes"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

type AgentPortraitSize = "xxs" | "xs" | "sm" | "md" | "lg" | "xl"

interface AgentPortraitProps {
  agent: Agent
  index: number
  size?: AgentPortraitSize
  /** 团队列 / 详情面板自带独立状态点时可关闭角标，避免重复 */
  showStatusDot?: boolean
  onClick?: () => void
  className?: string
}

const sizeClasses: Record<AgentPortraitSize, string> = {
  xxs: "size-6! text-[0.7rem]",
  xs: "size-9! text-lg",
  sm: "size-14! text-3xl",
  md: "text-[2.45rem]",
  lg: "size-24! text-5xl",
  xl: "size-16! text-[2.05rem]",
}

/** 形状相对容器留出内边距，避免贴住圆角描边。 */
const markSizes: Record<AgentPortraitSize, number> = {
  xxs: 18,
  xs: 27,
  sm: 42,
  md: 58,
  lg: 72,
  xl: 48,
}

/** Agent 状态 → BotMark 动效状态（failed 仍由 .agent-portrait 红色描边表达）。 */
function statusToMarkState(status: string): BotMarkState {
  if (status === "running") return "running"
  if (
    status === "pending" ||
    status === "waiting" ||
    status === "approval" ||
    status === "waiting_approval"
  ) {
    return "alert"
  }
  return "idle"
}

/**
 * Agent 肖像：使用 DS-Bot 形状库（按角色稳定映射 whale/star/moon/gumdrop/squircle），
 * 形状 + ink 是产品资产，优先于旧版 emoji 头像；agent.avatar 与形状的共存方案留待后续批次。
 */
export function AgentPortrait({
  agent,
  index,
  size = "md",
  showStatusDot = true,
  onClick,
  className,
}: AgentPortraitProps) {
  return (
    <span
      className={cn("agent-portrait shrink-0", sizeClasses[size], className)}
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
      aria-label={`${agent.name}，${agentStatusLabel(agent.status)}`}
    >
      <BotMark
        shape={botShapeForRole(agent.role)}
        size={markSizes[size]}
        state={statusToMarkState(agent.status)}
        ink="var(--portrait-tone, var(--console-accent))"
        className="pointer-events-none"
      />
      {showStatusDot ? (
        <span
          className="status-dot absolute right-0 bottom-1 size-2.5 rounded-full border-2 border-card"
          data-status={agent.status}
          aria-hidden="true"
        />
      ) : null}
    </span>
  )
}

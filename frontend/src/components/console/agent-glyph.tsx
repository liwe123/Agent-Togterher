import { BotMark } from "@/components/console/bot-mark"
import { Plug } from "@/components/ui/icons"
import { botShapeForRole } from "@/lib/bot-shapes"
import { cn } from "@/lib/utils"

interface AgentLike {
  id?: number
  role?: string | null
}

interface AgentGlyphProps {
  /** 内部 Agent（角色形状）；为空或 kind=integration 时显示外部节点图标。 */
  agent?: AgentLike | null
  /** 外层容器尺寸类，如 size-5 / size-7 / size-9；默认 size-6。 */
  className?: string
  /** BotMark / Plug 的像素尺寸，默认 16。 */
  markSize?: number
  /** 色调索引 0-5；缺省取 agent.id % 6。 */
  toneIndex?: number
  kind?: "agent" | "integration"
}

/**
 * 统一角色/外部节点图形（图标迁移收尾）：Agent 用 DS-Bot 角色形状，
 * 外部集成节点用 DS-Bot 线性 Plug 图标；替代旧版 emoji 头像。
 */
export function AgentGlyph({
  agent,
  className,
  markSize = 16,
  toneIndex,
  kind = "agent",
}: AgentGlyphProps) {
  const tone = toneIndex ?? (typeof agent?.id === "number" ? agent.id % 6 : 0)
  return (
    <span
      className={cn(
        "agent-avatar flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        className,
      )}
      data-tone={tone}
      aria-hidden="true"
    >
      {kind === "integration" || !agent ? (
        <Plug size={Math.max(12, markSize - 2)} />
      ) : (
        <BotMark
          shape={botShapeForRole(agent.role ?? "")}
          size={markSize}
          state="idle"
          ink="var(--avatar-tone, var(--console-accent))"
        />
      )}
    </span>
  )
}

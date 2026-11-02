"use client"

import { ROLE_LABELS } from "@/lib/mention-utils"
import { AgentGlyph } from "@/components/console/agent-glyph"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

interface ChatMemberStripProps {
  agents: Agent[]
  selectedAgentId: number | null
  onSelect: (agent: Agent) => void
}

/**
 * 群成员切换条（task-4 ④）：贴靠在右侧 DetailsPanel 上方的一排横向 chip。
 * 不改 details-panel.tsx，由聊天页在外层包裹，点选成员即切换详情面板对象。
 */
export function ChatMemberStrip({
  agents,
  selectedAgentId,
  onSelect,
}: ChatMemberStripProps) {
  return (
    <div
      role="group"
      aria-label="切换群成员详情"
      className="console-scroll flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b-[0.5px] border-console-line bg-console-surface px-3"
    >
      <span className="shrink-0 px-1 text-[11px] font-semibold text-console-ink-3">
        成员
      </span>
      {agents.map((agent, index) => {
        const active = agent.id === selectedAgentId
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelect(agent)}
            aria-pressed={active}
            title={`${agent.name} · ${ROLE_LABELS[agent.role] ?? agent.role}`}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] px-2 transition-colors duration-150 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none",
              active
                ? "border-console-accent/60 bg-console-active text-console-ink"
                : "border-console-line bg-console-raised text-console-ink-2 hover:bg-console-hover hover:text-console-ink",
            )}
          >
            <AgentGlyph agent={agent} toneIndex={index} className="size-5" markSize={14} />
            <span className="max-w-[7rem] truncate text-[12px] font-medium">
              {agent.name}
            </span>
            <span
              className="status-dot size-1.5 shrink-0 rounded-full"
              data-status={agent.status}
              aria-hidden="true"
            />
          </button>
        )
      })}
    </div>
  )
}

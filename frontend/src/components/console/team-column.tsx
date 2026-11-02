"use client"

import { AlertCircle, Bot, ChevronsUpDown } from "@/components/ui/icons"

import { AgentPortrait } from "@/components/console/agent-portrait"
import {
  agentPreview,
  agentRoleLabel,
  agentStatusDotClass,
  agentStatusLabel,
} from "@/components/console/agent-meta"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

interface TeamColumnProps {
  workspaceName: string
  agents: Agent[]
  isLoading: boolean
  error: string | null
  selectedAgentId?: number | null
  onSelectAgent?: (agent: Agent) => void
  onOpenWorkspaceMenu?: () => void
  workspaceMenuOpen?: boolean
  onRetry?: () => void
  className?: string
}

/**
 * 侧栏团队列（264px）：工作区入口 + 主 Agent 磁贴 + Agent 行列表。
 * 行点击交给上层：控制台页打开右侧详情面板，其它页面跳转 /chats?mention=<name>。
 */
export function TeamColumn({
  workspaceName,
  agents,
  isLoading,
  error,
  selectedAgentId = null,
  onSelectAgent,
  onOpenWorkspaceMenu,
  workspaceMenuOpen = false,
  onRetry,
  className,
}: TeamColumnProps) {
  const onlineCount = agents.filter((agent) => agent.status !== "failed").length
  const featuredAgent =
    agents.find((agent) => agent.status === "running") ?? agents[0] ?? null

  return (
    <div
      className={cn(
        "flex w-[264px] shrink-0 flex-col border-r border-console-line bg-console-sidebar",
        className,
      )}
      aria-label="团队列"
    >
      {/* 工作区切换入口 */}
      <div className="flex h-[72px] shrink-0 items-center border-b border-console-line px-3">
        <button
          type="button"
          onClick={onOpenWorkspaceMenu}
          aria-expanded={workspaceMenuOpen}
          aria-haspopup="menu"
          title={`切换工作区：${workspaceName}`}
          className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors duration-[var(--console-dur-list,190ms)] hover:bg-console-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/60 motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-semibold leading-[18px] text-console-ink">
              {workspaceName}
            </span>
            <span className="console-meta truncate">
              {onlineCount} 人在线 · {agents.length} 位 Agent
            </span>
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-console-ink-3 transition-transform duration-[var(--console-dur-list,190ms)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
              workspaceMenuOpen && "rotate-180",
            )}
          />
        </button>
      </div>

      {/* 主 Agent 磁贴 */}
      <div className="shrink-0 px-2 pt-3">
        {isLoading && agents.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 px-2 py-3"
            aria-busy="true"
            aria-label="正在加载团队信息"
          >
            <span className="size-16 animate-pulse rounded-full bg-console-raised motion-reduce:animate-none" />
            <span className="h-3.5 w-20 animate-pulse rounded-full bg-console-raised motion-reduce:animate-none" />
            <span className="h-3 w-14 animate-pulse rounded-full bg-console-raised/70 motion-reduce:animate-none" />
          </div>
        ) : error && agents.length === 0 ? null : featuredAgent ? (
          <button
            type="button"
            onClick={() => onSelectAgent?.(featuredAgent)}
            aria-label={`主 Agent：${featuredAgent.name}，${agentRoleLabel(featuredAgent.role)}`}
            data-active={featuredAgent.id === selectedAgentId}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-[14px] px-3 py-4 text-center transition-colors duration-[var(--console-dur-list,190ms)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
              featuredAgent.id === selectedAgentId
                ? "bg-console-active"
                : "hover:bg-console-hover",
            )}
          >
            <AgentPortrait
              agent={featuredAgent}
              index={featuredAgent.id}
              size="xl"
              showStatusDot={false}
            />
            <span className="flex w-full flex-col items-center gap-1">
              <span className="max-w-full truncate text-[14px] font-semibold leading-5 text-console-ink">
                {featuredAgent.name}
              </span>
              <span className="console-pill px-2 py-0.5 text-[11px] leading-4 text-console-ink-3">
                {agentRoleLabel(featuredAgent.role)}
              </span>
            </span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2 px-3 py-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-console-raised text-console-ink-3">
              <Bot aria-hidden="true" className="size-5" />
            </span>
            <p className="text-[13px] leading-[18px] text-console-ink-2">团队席还空着</p>
            <p className="console-meta">启动后端后将自动载入默认 Agent</p>
          </div>
        )}
      </div>

      {/* 分区标题 */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-1.5">
        <span className="console-section-title">团队</span>
        <span className="console-meta">{agents.length} 人</span>
      </div>

      {/* Agent 行列表（独立滚动） */}
      <div className="console-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && agents.length === 0 ? (
          <div aria-busy="true" aria-label="正在加载团队信息">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-2.5 px-2 py-3">
                <span className="size-9 shrink-0 animate-pulse rounded-full bg-console-raised motion-reduce:animate-none" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="h-3 w-20 max-w-full animate-pulse rounded-full bg-console-raised motion-reduce:animate-none" />
                  <span className="h-2.5 w-28 max-w-full animate-pulse rounded-full bg-console-raised/70 motion-reduce:animate-none" />
                </span>
              </div>
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="mx-1 mt-1 rounded-[10px] border border-console-line px-3 py-3"
          >
            <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-console-ink-2">
              <AlertCircle aria-hidden="true" className="size-3.5 shrink-0 text-console-danger" />
              团队信息加载失败
            </p>
            <p className="console-meta mt-1 break-words">{error}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="console-pill mt-2 px-2.5 py-1 text-[12px] font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
              >
                重新加载
              </button>
            ) : null}
          </div>
        ) : agents.length === 0 ? (
          <p className="console-meta px-2 py-3">暂无 Agent 成员</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {agents.map((agent) => {
              const selected = agent.id === selectedAgentId
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onSelectAgent?.(agent)}
                  data-active={selected}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`${agent.name}，${agentRoleLabel(agent.role)}，${agentStatusLabel(agent.status)}`}
                  className="console-row w-full text-left"
                >
                  <AgentPortrait agent={agent} index={agent.id} size="xs" showStatusDot={false} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] leading-5 text-console-ink">
                      {agent.name}
                    </span>
                    <span className="truncate text-[13px] leading-[18px] text-console-ink-3">
                      {agentPreview(agent)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      agentStatusDotClass(agent.status),
                    )}
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

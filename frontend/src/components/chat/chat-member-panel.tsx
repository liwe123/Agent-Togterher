"use client"

import { useEffect } from "react"
import Link from "next/link"
import { ContactRound, UsersRound, X } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ROLE_LABELS } from "@/lib/mention-utils"
import { formatRelativeTime } from "@/lib/relay-utils"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

const statusLabels: Record<string, string> = {
  idle: "空闲",
  running: "工作中",
  failed: "异常",
  waiting: "等待中",
}

interface ChatMemberPanelProps {
  agents: Agent[]
  onClose: () => void
}

/**
 * 群聊成员面板（PRD FR5）：只读展示成员职责、绑定模型与实时状态。
 * 桌面端为聊天卡片内右栏，移动端为覆盖抽屉；Escape 与遮罩均可关闭。
 */
export function ChatMemberPanel({ agents, onClose }: ChatMemberPanelProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <>
      <button
        type="button"
        className="chat-member-backdrop"
        aria-label="关闭成员面板"
        onClick={onClose}
      />
      <aside
        id="chat-member-panel"
        className="chat-member-panel"
        aria-label="群聊成员"
      >
        <header className="chat-member-head">
          <span className="chat-member-title">
            <UsersRound aria-hidden="true" className="size-4" />
            群成员
            <span className="chat-member-count">{agents.length}</span>
          </span>
          <button
            type="button"
            className="chat-member-close"
            onClick={onClose}
            aria-label="关闭成员面板"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <ul className="chat-member-list">
          {agents.map((agent, index) => (
            <li key={agent.id} className="chat-member-row" data-status={agent.status}>
              <Avatar
                size="sm"
                className="agent-avatar size-9 shrink-0"
                data-tone={index % 6}
              >
                <AvatarFallback className="rounded-full text-xs">
                  {agent.avatar ?? agent.name.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="chat-member-body">
                <p className="chat-member-name">
                  {agent.name}
                  <span className="chat-member-role">
                    {ROLE_LABELS[agent.role] ?? agent.role}
                  </span>
                </p>
                <p className="chat-member-model" title={`绑定模型 ${agent.model_name}`}>
                  {agent.model_name}
                </p>
              </div>
              <div className="chat-member-state">
                <span className="chat-member-status">
                  <span
                    className="status-dot size-1.5 rounded-full"
                    data-status={agent.status}
                    aria-hidden="true"
                  />
                  {statusLabels[agent.status] ?? agent.status}
                </span>
                <time
                  className={cn("chat-member-seen")}
                  dateTime={agent.last_active_at ?? undefined}
                >
                  {formatRelativeTime(agent.last_active_at)}
                </time>
              </div>
            </li>
          ))}
          {agents.length === 0 && (
            <li className="chat-member-empty">当前工作区还没有 Agent。</li>
          )}
        </ul>

        <footer className="chat-member-foot">
          <Link href="/contacts" className="chat-member-link">
            <ContactRound aria-hidden="true" className="size-3.5" />
            打开通讯录
          </Link>
          <p className="chat-member-hint">成员由工作区统一管理，此面板只读。</p>
        </footer>
      </aside>
    </>
  )
}

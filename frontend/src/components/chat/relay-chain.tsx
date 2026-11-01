"use client"

import { Link2, LoaderCircle, TriangleAlert, Check, MinusCircle } from "lucide-react"
import Link from "next/link"

import { deriveRelayHops, type RelayProgressReducer } from "@/lib/relay-utils"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"
import type { ChatTask } from "@/types/chat"

const ACTIVE_STATUSES = new Set(["pending", "running", "waiting_approval"])

const hopStateLabels: Record<string, string> = {
  pending: "待执行",
  active: "处理中",
  done: "已完成",
  passed: "已跳过",
  failed: "失败",
}

interface RelayChainProps {
  tasks: ChatTask[]
  agents: Agent[]
  progress: RelayProgressReducer
}

/**
 * 群聊接力链：展示进行中接力任务的棒次与实时状态（PRD FR4）。
 * 参考 DS-Bot 群聊「本轮发言顺序」的表达：顺序、当前发言者与已完成者一眼可见。
 */
export function RelayChain({ tasks, agents, progress }: RelayChainProps) {
  const activeTask = [...tasks]
    .filter(
      (task) =>
        (task.relay_agent_ids?.length ?? 0) >= 2 && ACTIVE_STATUSES.has(task.status),
    )
    .sort((left, right) => right.id - left.id)[0]

  if (!activeTask) return null

  const chain = activeTask.relay_agent_ids ?? []
  const hops = deriveRelayHops(
    chain,
    agents,
    progress[activeTask.id],
    activeTask.status,
  )
  const finished = hops.filter((hop) => hop.state === "done" || hop.state === "passed").length
  const activeIndex = hops.findIndex((hop) => hop.state === "active")

  return (
    <section
      className="relay-chain"
      aria-label={`接力任务 #${activeTask.id} 进度`}
      data-task-id={activeTask.id}
    >
      <div className="relay-chain-head">
        <span className="relay-chain-label">
          <Link2 aria-hidden="true" className="size-3.5" />
          接力 {Math.min(finished + 1, hops.length)}/{hops.length}
        </span>
        <span className="relay-chain-task">Task #{activeTask.id}</span>
        <Link href={`/tasks/${activeTask.id}`} className="relay-chain-link">
          查看任务
        </Link>
      </div>
      <ol className="relay-chain-list">
        {hops.map((hop, index) => (
          <li
            key={hop.agentId}
            className="relay-hop"
            data-state={hop.state}
            aria-current={hop.state === "active" ? "step" : undefined}
          >
            <span
              className={cn("relay-hop-index", "agent-avatar")}
              data-tone={index % 6}
              aria-hidden="true"
            >
              {hop.name.slice(0, 2)}
            </span>
            <span className="relay-hop-body">
              <span className="relay-hop-name">{hop.name}</span>
              <span className="relay-hop-state">
                {hop.state === "active" ? (
                  <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
                ) : hop.state === "done" ? (
                  <Check aria-hidden="true" className="size-3" />
                ) : hop.state === "passed" ? (
                  <MinusCircle aria-hidden="true" className="size-3" />
                ) : hop.state === "failed" ? (
                  <TriangleAlert aria-hidden="true" className="size-3" />
                ) : null}
                {hopStateLabels[hop.state]}
              </span>
            </span>
            {index === activeIndex && <span className="relay-hop-dot" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </section>
  )
}

"use client"

import { AlertCircle, ArrowLeft, ChevronRight, UsersRound } from "lucide-react"
import Link from "next/link"
import { useCallback, useMemo, useState } from "react"

import { TaskApprovalCard } from "@/components/chat/action-card"
import { ChatComposer } from "@/components/chat/chat-composer"
import { ChatMemberPanel } from "@/components/chat/chat-member-panel"
import { ChatMemberStrip } from "@/components/chat/chat-member-strip"
import {
  MessageList,
  type ApprovalController,
  type TypingState,
} from "@/components/chat/message-list"
import { RelayChain } from "@/components/chat/relay-chain"
import { AppSidebar } from "@/components/console/app-sidebar"
import { DetailsPanel } from "@/components/console/details-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { useChat } from "@/hooks/use-chat"
import { useIntegrations } from "@/hooks/use-integrations"
import { usePermissions } from "@/hooks/use-permissions"
import { collectApprovalPlacement } from "@/lib/action-cards"
import { deriveRelayHops } from "@/lib/relay-utils"
import type { ApprovalDecision, ChatTask } from "@/types/chat"

const connectionLabels: Record<string, string> = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接断开",
}

const ACTIVE_TASK_STATUSES = new Set(["pending", "running", "waiting_approval"])

/**
 * 把「正在发送」或接力活跃棒次折算成列表尾部的 typing 行（P1-9）。
 * relay_progress 事件只保留棒次状态，按 relay_agent_ids 的棒次顺序还原 Agent。
 */
function buildTypingState(
  tasks: ChatTask[],
  agents: ReturnType<typeof useChat>["agents"],
  relayProgress: ReturnType<typeof useChat>["relayProgress"],
  isSending: boolean,
): TypingState | null {
  const activeTask = tasks
    .filter(
      (task) =>
        (task.relay_agent_ids?.length ?? 0) >= 2 &&
        ACTIVE_TASK_STATUSES.has(task.status),
    )
    .sort((left, right) => right.id - left.id)[0]

  if (activeTask) {
    const chain = activeTask.relay_agent_ids ?? []
    const hops = deriveRelayHops(
      chain,
      agents,
      relayProgress[activeTask.id],
      activeTask.status,
    )
    const activeIndex = hops.findIndex((hop) => hop.state === "active")
    const pendingIndex = hops.findIndex((hop) => hop.state === "pending")
    const focusIndex = activeIndex >= 0 ? activeIndex : pendingIndex
    if (focusIndex >= 0) {
      const hop = hops[focusIndex]
      const agent = agents.find((item) => item.id === hop.agentId)
      const position = `第 ${focusIndex + 1}/${hops.length} 棒`
      return {
        agent,
        label:
          activeIndex >= 0
            ? `${hop.name} 正在接力（${position}）…`
            : `等待 ${hop.name} 接棒（${position}）…`,
      }
    }
  }

  if (isSending) {
    const agent = agents[0]
    return {
      agent,
      label: agent ? `正在派发任务给 ${agent.name}…` : "正在派发任务…",
    }
  }

  return null
}

export function ChatPage() {
  const {
    workspace,
    conversation,
    agents,
    messages,
    tasks,
    connectionStatus,
    isLoading,
    isSending,
    error,
    relayProgress,
    currentUserRole,
    retry,
    sendMessage,
    approveTask,
    rejectTask,
  } = useChat()

  const { nodes: integrationNodes } = useIntegrations(workspace?.id ?? null)
  // 移动端抽屉：成员面板；桌面端由右侧 DetailsPanel 承担（P0-3 / P1-1）。
  const [membersOpen, setMembersOpen] = useState(false)
  const toggleMembers = () => setMembersOpen((open) => !open)
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const { isAdmin: canApprove } = usePermissions(currentUserRole)

  // ---- 人工审批卡状态（P0-6）：busy / 错误 / 稍后处理 / 本会话说明 ----
  const [approvalBusyId, setApprovalBusyId] = useState<number | null>(null)
  const [approvalErrors, setApprovalErrors] = useState<Map<number, string>>(
    new Map(),
  )
  const [dismissedApprovals, setDismissedApprovals] = useState<Set<number>>(
    new Set(),
  )
  const [approvalNotes, setApprovalNotes] = useState<Map<number, string>>(
    new Map(),
  )

  const approvalPlacement = useMemo(
    () => collectApprovalPlacement(tasks, messages, dismissedApprovals),
    [tasks, messages, dismissedApprovals],
  )

  function openDetails() {
    setMembersOpen(false)
    setSelectedAgentId((current) => {
      if (current !== null && agents.some((agent) => agent.id === current)) {
        return current
      }
      return agents[0]?.id ?? null
    })
    setDetailsOpen(true)
  }

  const typing = useMemo(
    () => buildTypingState(tasks, agents, relayProgress, isSending),
    [tasks, agents, relayProgress, isSending],
  )

  const handleApproval = useCallback(
    async (taskId: number, decision: ApprovalDecision) => {
      setApprovalErrors((current) => {
        if (!current.has(taskId)) return current
        const next = new Map(current)
        next.delete(taskId)
        return next
      })
      setApprovalBusyId(taskId)
      try {
        if (decision === "approve") {
          await approveTask(taskId)
        } else {
          await rejectTask(taskId)
        }
        // 成功后 hook 已按返回的任务更新本地状态 → 卡片随 status 变化自动收起；
        // 后端同时广播 task.status_changed 作为二次佐证。
      } catch (requestError) {
        setApprovalErrors((current) =>
          new Map(current).set(
            taskId,
            requestError instanceof Error
              ? requestError.message
              : "审批操作失败，请稍后重试。",
          ),
        )
      } finally {
        setApprovalBusyId((current) => (current === taskId ? null : current))
      }
    },
    [approveTask, rejectTask],
  )

  const handleApprove = useCallback(
    (taskId: number) => {
      void handleApproval(taskId, "approve")
    },
    [handleApproval],
  )
  const handleReject = useCallback(
    (taskId: number) => {
      void handleApproval(taskId, "reject")
    },
    [handleApproval],
  )
  const handleDismissApproval = useCallback((taskId: number) => {
    setDismissedApprovals((current) => {
      const next = new Set(current)
      next.add(taskId)
      return next
    })
  }, [])
  const handleRestoreApprovals = useCallback(() => {
    setDismissedApprovals(new Set())
  }, [])
  const handleSaveApprovalNote = useCallback((taskId: number, note: string) => {
    setApprovalNotes((current) => new Map(current).set(taskId, note))
  }, [])

  const approvalController = useMemo<ApprovalController>(
    () => ({
      canApprove,
      busyTaskId: approvalBusyId,
      errors: approvalErrors,
      notes: approvalNotes,
      onApprove: handleApprove,
      onReject: handleReject,
      onDismiss: handleDismissApproval,
      onSaveNote: handleSaveApprovalNote,
    }),
    [
      canApprove,
      approvalBusyId,
      approvalErrors,
      approvalNotes,
      handleApprove,
      handleReject,
      handleDismissApproval,
      handleSaveApprovalNote,
    ],
  )

  return (
    <div className="console-shell grid h-svh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[auto_minmax(0,1fr)]">
      <AppSidebar
        connectionStatus={connectionStatus}
        activeItem="chats"
        agents={agents}
        selectedAgentId={selectedAgentId}
      />

      <ErrorBoundary>
        <main className="console-main mobile-chat-main flex min-h-0 flex-col px-0 py-0 md:px-6 md:py-5 xl:px-8">
          <div className="mx-auto flex min-h-0 w-full max-w-[1520px] flex-1 gap-4">
            {error && !conversation ? (
              <section className="flex min-h-0 flex-1 items-center justify-center rounded-console-lg border-[0.5px] border-console-line bg-console-surface p-6">
                <div className="flex max-w-md flex-col items-center gap-4 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-console-tag text-console-danger">
                    <AlertCircle aria-hidden="true" className="size-5" />
                  </span>
                  <div className="space-y-1.5">
                    <h2 className="text-base font-semibold text-console-ink">无法打开群聊</h2>
                    <p className="text-sm leading-6 text-console-ink-2">{error}</p>
                  </div>
                  <Button type="button" variant="outline" className="rounded-full" onClick={retry}>
                    重新连接
                  </Button>
                </div>
              </section>
            ) : (
            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-console-bg md:rounded-console-lg">
              {/* 移动端紧凑头部：返回 + 标题 + 成员入口 */}
              <div className="flex h-16 shrink-0 items-center justify-between border-b-[0.5px] border-console-line bg-console-bg px-4 md:hidden">
                <Link
                  href="/"
                  aria-label="返回控制台"
                  className="flex size-10 items-center justify-center rounded-full text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
                >
                  <ArrowLeft aria-hidden="true" className="size-5" />
                </Link>
                <div className="min-w-0 text-center">
                  <h1 className="truncate text-sm font-medium text-console-ink">
                    {conversation?.title ?? "默认群聊"}
                  </h1>
                  <p className="mt-0.5 text-[11px] text-console-ink-3 console-tabular">
                    {agents.length} 位 Agent 在线协作 · {messages.length} 条消息
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleMembers}
                  aria-label="查看群成员"
                  aria-expanded={membersOpen}
                  aria-controls="chat-member-panel"
                  className="flex size-10 items-center justify-center rounded-full text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
                >
                  <UsersRound aria-hidden="true" className="size-5" />
                </button>
              </div>

              {/* 桌面端：浮在内容上的居中胶囊头（P0-3），下方渐变遮罩收口 */}
              <header className="relative z-20 hidden h-[60px] shrink-0 md:block">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-[60px]"
                  style={{
                    background:
                      "linear-gradient(to bottom, var(--console-bg) 0%, color-mix(in srgb, var(--console-bg) 72%, transparent) 62%, transparent 100%)",
                  }}
                />
                <div className="relative flex h-[60px] items-center justify-center px-4">
                  <button
                    type="button"
                    onClick={openDetails}
                    aria-expanded={detailsOpen}
                    className="group console-pill inline-flex h-10 max-w-[70%] items-center gap-2 rounded-full px-3.5 text-console-ink transition-colors duration-150 hover:bg-console-hover motion-reduce:transition-none [[data-motion=quiet]_&]:transition-none"
                    title={`${connectionLabels[connectionStatus]} · 点击查看 Agent 详情与模型绑定`}
                  >
                    <span
                      className="status-dot size-2 shrink-0 rounded-full"
                      data-status={connectionStatus}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium leading-5">
                      {conversation?.title ?? "正在准备默认会话…"}
                    </span>
                    <span className="shrink-0 text-xs text-console-ink-3 console-tabular">
                      {agents.length} 位成员
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="h-4 w-0 shrink-0 opacity-0 transition-all duration-200 ease-out group-hover:w-4 group-hover:opacity-100 group-focus-visible:w-4 group-focus-visible:opacity-100 motion-reduce:transition-none [[data-motion=quiet]_&]:transition-[opacity]"
                    />
                  </button>
                  <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    <span className="text-[11px] text-console-ink-3 console-tabular">
                      {messages.length} 条消息
                    </span>
                    <button
                      type="button"
                      onClick={openDetails}
                      aria-label="查看群成员详情"
                      title="查看群成员详情"
                      className="flex size-8 items-center justify-center rounded-full text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
                    >
                      <UsersRound aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </div>
              </header>

              {detailsOpen ? (
                <div className="hidden shrink-0 xl:block">
                  <ChatMemberStrip
                    agents={agents}
                    selectedAgentId={selectedAgentId}
                    onSelect={(agent) => setSelectedAgentId(agent.id)}
                  />
                </div>
              ) : null}

              <RelayChain tasks={tasks} agents={agents} progress={relayProgress} />

              <div className="chat-stage flex min-h-0 flex-1">
                <MessageList
                  messages={messages}
                  tasks={tasks}
                  agents={agents}
                  isLoading={isLoading}
                  typing={typing}
                  approvals={approvalPlacement}
                  approvalController={approvalController}
                />
                {membersOpen ? (
                  <div className="md:hidden">
                    <ChatMemberPanel
                      agents={agents}
                      onClose={() => setMembersOpen(false)}
                    />
                  </div>
                ) : null}
              </div>

              {approvalPlacement.dock.length > 0 ? (
                <div className="flex shrink-0 flex-col gap-2 px-4 pt-2 md:px-6">
                  {approvalPlacement.dock.map((task) => (
                    <TaskApprovalCard
                      key={task.id}
                      task={task}
                      agent={agents.find(
                        (agent) => agent.id === task.assigned_agent_id,
                      )}
                      variant="dock"
                      busy={approvalBusyId === task.id}
                      error={approvalErrors.get(task.id) ?? null}
                      canApprove={canApprove}
                      initialNote={approvalNotes.get(task.id)}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      onDismiss={handleDismissApproval}
                      onSaveNote={handleSaveApprovalNote}
                    />
                  ))}
                </div>
              ) : null}

              {dismissedApprovals.size > 0 ? (
                <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2 md:px-6">
                  <span className="console-meta">
                    已收起 {dismissedApprovals.size} 张审批卡
                  </span>
                  <button
                    type="button"
                    onClick={handleRestoreApprovals}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-console-accent transition-colors hover:bg-console-hover"
                  >
                    恢复显示
                  </button>
                </div>
              ) : null}

              <ChatComposer
                agents={agents}
                integrationNodes={integrationNodes}
                disabled={!conversation || Boolean(error)}
                isSending={isSending}
                onSend={sendMessage}
              />
            </section>
            )}
            <DetailsPanel
              agent={selectedAgent}
              open={detailsOpen}
              onClose={() => setDetailsOpen(false)}
            />
          </div>
        </main>
      </ErrorBoundary>
    </div>
  )
}

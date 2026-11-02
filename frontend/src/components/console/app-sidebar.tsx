"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Check,
  ContactRound,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MessageCircleMore,
  Plus,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  Workflow,
  X,
} from "@/components/ui/icons"

import { TeamColumn } from "@/components/console/team-column"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useTeamRoster } from "@/hooks/use-team-roster"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { clearTokens, getRefreshToken } from "@/lib/auth"
import { apiBaseUrl } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type { Agent, ConnectionStatus } from "@/types/agent"
import type { WorkspaceRole } from "@/types/membership"

const navigation = [
  { id: "console", label: "控制台", icon: LayoutDashboard, href: "/" },
  { id: "chats", label: "群聊", icon: MessageCircleMore, href: "/chats" },
  { id: "contacts", label: "通讯录", icon: ContactRound, href: "/contacts" },
  { id: "tasks", label: "任务", icon: ListTodo, href: "/tasks" },
  { id: "workflows", label: "工作流", icon: Workflow, href: "/workflows" },
  { id: "settings", label: "设置", icon: Settings, href: "/settings" },
] as const

const ROLE_SHORT_LABELS: Record<WorkspaceRole, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  viewer: "观察者",
}

interface AppSidebarProps {
  connectionStatus: ConnectionStatus
  activeItem?: (typeof navigation)[number]["id"]
  /** 上层已持有 Agent 名单时直接传入，避免重复请求 */
  agents?: Agent[]
  agentsLoading?: boolean
  agentsError?: string | null
  onRetryAgents?: () => void
  selectedAgentId?: number | null
  /** 传入后行点击改为回调（控制台页打开详情面板），否则跳转 /chats?mention= */
  onSelectAgent?: (agent: Agent) => void
}

export function AppSidebar({
  connectionStatus,
  activeItem = "console",
  agents,
  agentsLoading,
  agentsError,
  onRetryAgents,
  selectedAgentId = null,
  onSelectAgent,
}: AppSidebarProps) {
  const router = useRouter()
  const {
    workspaces,
    activeWorkspace,
    currentUserRole,
    isLoading: workspacesLoading,
    switchWorkspace,
    createWorkspace,
    joinWorkspace,
  } = useWorkspaces()

  const usingExternalAgents = agents !== undefined
  const roster = useTeamRoster({
    workspaceId: activeWorkspace?.id ?? null,
    enabled: !usingExternalAgents && activeWorkspace !== null,
  })
  const rosterAgents = agents ?? roster.agents
  const rosterLoading = usingExternalAgents
    ? (agentsLoading ?? false)
    : roster.isLoading || workspacesLoading
  const rosterError = usingExternalAgents
    ? (agentsError ?? null)
    : roster.error
  const rosterRetry = usingExternalAgents ? onRetryAgents : roster.retry

  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)

  const [newWsName, setNewWsName] = useState("")
  const [newWsDesc, setNewWsDesc] = useState("")
  const [joinCode, setJoinCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 自绘弹层状态：替换原生 alert/confirm
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    const refreshToken = getRefreshToken()
    const controller = new AbortController()
    // 后端无响应时不阻塞本地登出，最长等待 5 秒
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    try {
      // 先吊销后端 refresh token；网络/后端异常不阻塞本地登出
      if (refreshToken) {
        await fetch(`${apiBaseUrl}/api/v1/auth/logout`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
          keepalive: true,
          signal: controller.signal,
        })
      }
    } catch {
      // 忽略：无论后端是否可用都必须清除本地会话
    } finally {
      clearTimeout(timeoutId)
      clearTokens()
      setIsLoggingOut(false)
      setShowLogoutConfirm(false)
      router.push("/login")
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWsName.trim()) return
    setIsSubmitting(true)
    setCreateError(null)
    try {
      await createWorkspace(newWsName.trim(), newWsDesc.trim())
      setShowCreateModal(false)
      setNewWsName("")
      setNewWsDesc("")
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "创建工作区失败")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!joinCode.trim()) return
    setIsSubmitting(true)
    setJoinError(null)
    try {
      await joinWorkspace(joinCode.trim())
      setShowJoinModal(false)
      setJoinCode("")
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : "加入工作区失败")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAgentSelect = (agent: Agent) => {
    if (onSelectAgent) {
      onSelectAgent(agent)
      return
    }
    router.push(`/chats?mention=${encodeURIComponent(agent.name)}`)
  }

  const connectionLabel =
    connectionStatus === "online"
      ? "实时通道已连接"
      : connectionStatus === "connecting"
        ? "实时通道连接中"
        : "实时通道未连接"

  return (
    <>
      {/* Desktop: 76px 导航 rail + 264px 团队列 */}
      <aside className="sticky top-0 z-10 hidden h-svh shrink-0 border-r border-console-line bg-console-sidebar text-console-ink md:flex">
        <div className="flex w-[76px] shrink-0 flex-col items-center border-r border-console-line">
          {/* 品牌 / 工作区入口 */}
          <div className="flex h-[72px] w-full shrink-0 items-center justify-center border-b border-console-line">
            <button
              type="button"
              onClick={() => setShowWorkspaceMenu((prev) => !prev)}
              title={`当前工作区: ${activeWorkspace?.name || "默认工作区"} (${ROLE_SHORT_LABELS[currentUserRole] || "成员"})`}
              aria-label="切换工作区"
              aria-expanded={showWorkspaceMenu}
              aria-haspopup="menu"
              className="group relative flex size-11 items-center justify-center rounded-2xl border border-console-line-2 bg-console-raised text-console-accent transition-colors duration-[var(--console-dur-tap,290ms)] hover:bg-console-hover active:bg-console-active motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/60"
            >
              <Sparkles
                aria-hidden="true"
                className="size-5 transition-transform duration-[var(--console-dur-tap,290ms)] group-hover:rotate-12 motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
              />
              <span
                className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-console-sidebar bg-console-success"
                aria-hidden="true"
              />
            </button>
          </div>

          {/* 导航项 */}
          <nav aria-label="主导航" className="flex w-full flex-1 flex-col items-center gap-2 py-5">
            {navigation.map((item) => {
              const Icon = item.icon
              const isActive = item.id === activeItem
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className="group flex w-full flex-col items-center gap-1 text-center focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-[var(--console-dur-tap,290ms)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
                      isActive
                        ? "bg-console-active text-console-accent"
                        : "text-console-ink-3 group-hover:bg-console-hover group-hover:text-console-ink",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium leading-4 transition-colors duration-[var(--console-dur-tap,290ms)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
                      isActive
                        ? "font-semibold text-console-ink"
                        : "text-console-ink-3 group-hover:text-console-ink",
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              )
            })}
          </nav>

          {/* 底部：退出登录 + 连接状态 */}
          <div className="flex w-full flex-col items-center gap-2 border-t border-console-line py-4">
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              title="退出登录"
              aria-label="退出登录"
              disabled={isLoggingOut}
              className="flex size-9 items-center justify-center rounded-full text-console-ink-3 transition-colors hover:bg-console-hover hover:text-console-danger disabled:opacity-50 motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>

            <div className="flex h-8 w-full items-center justify-center" title={connectionLabel}>
              <span
                className="status-dot size-2.5 rounded-full"
                data-status={connectionStatus}
                aria-hidden="true"
              />
              <span className="sr-only">{connectionLabel}</span>
            </div>
          </div>
        </div>

        <TeamColumn
          className="hidden lg:flex"
          workspaceName={activeWorkspace?.name || "默认工作区"}
          agents={rosterAgents}
          isLoading={rosterLoading}
          error={rosterError}
          selectedAgentId={selectedAgentId}
          onSelectAgent={handleAgentSelect}
          onOpenWorkspaceMenu={() => setShowWorkspaceMenu((prev) => !prev)}
          workspaceMenuOpen={showWorkspaceMenu}
          onRetry={rosterRetry}
        />
      </aside>

      {/* 工作区切换弹层 */}
      {showWorkspaceMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowWorkspaceMenu(false)}
          />
          <div className="console-card fixed top-4 left-[76px] z-50 w-72 space-y-2 p-3 shadow-2xl lg:left-[340px]">
            <div className="flex items-center justify-between border-b border-console-line px-2 py-1.5">
              <span className="console-section-title">我的协作工作区</span>
              <span className="console-pill px-1.5 py-0.5 font-mono text-[10px] text-console-ink-2">
                {workspaces.length} 个
              </span>
            </div>

            <div className="console-scroll max-h-60 space-y-1 overflow-y-auto">
              {workspaces.map((ws) => {
                const isCurrent = ws.id === activeWorkspace?.id
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => {
                      switchWorkspace(ws.id)
                      setShowWorkspaceMenu(false)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      isCurrent
                        ? "bg-console-active font-medium text-console-ink"
                        : "text-console-ink-2 hover:bg-console-hover hover:text-console-ink",
                    )}
                  >
                    <span className="flex min-w-0 flex-col truncate pr-2">
                      <span className="truncate">{ws.name}</span>
                      <span className="text-[10px] text-console-ink-3">
                        {ROLE_SHORT_LABELS[ws.role] || ws.role}
                      </span>
                    </span>
                    {isCurrent && (
                      <Check className="size-4 shrink-0 text-console-accent" aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>

            <div className="space-y-1 border-t border-console-line pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowWorkspaceMenu(false)
                  setCreateError(null)
                  setShowCreateModal(true)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                创建新工作区
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowWorkspaceMenu(false)
                  setJoinError(null)
                  setShowJoinModal(true)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
              >
                <UserPlus className="size-3.5" aria-hidden="true" />
                输入邀请码加入
              </button>

              <Link
                href="/settings/members"
                onClick={() => setShowWorkspaceMenu(false)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
              >
                <Users className="size-3.5" aria-hidden="true" />
                成员与权限管理
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Create Workspace Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) {
              setShowCreateModal(false)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isSubmitting) {
              setShowCreateModal(false)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-workspace-title"
            className="console-card w-full max-w-md space-y-4 border border-console-line p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-console-line pb-3">
              <h2 id="create-workspace-title" className="text-lg font-bold text-console-ink">创建新协作工作区</h2>
              <button
                type="button"
                aria-label="关闭创建弹窗"
                onClick={() => setShowCreateModal(false)}
                className="rounded-md p-1 text-console-ink-3 transition-colors hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {createError && (
              <div
                role="alert"
                className="rounded-lg border border-console-danger/40 bg-console-danger/10 px-3 py-2 text-xs font-medium text-console-danger"
              >
                {createError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ws-name">工作区名称</label>
                <input
                  id="ws-name"
                  type="text"
                  required
                  autoFocus
                  placeholder="如：智能体研发团队"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  className="w-full rounded-md border border-console-line-2 bg-console-surface-2 px-3 py-2 text-sm text-console-ink focus:border-console-accent focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ws-desc">描述（可选）</label>
                <input
                  id="ws-desc"
                  type="text"
                  placeholder="协作空间的主要职责"
                  value={newWsDesc}
                  onChange={(e) => setNewWsDesc(e.target.value)}
                  className="w-full rounded-md border border-console-line-2 bg-console-surface-2 px-3 py-2 text-sm text-console-ink focus:border-console-accent focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-console-line-2 px-4 py-2 text-sm font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-console-accent px-4 py-2 text-sm font-semibold text-console-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? "创建中..." : "立即创建"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Workspace Modal */}
      {showJoinModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) {
              setShowJoinModal(false)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !isSubmitting) {
              setShowJoinModal(false)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-workspace-title"
            className="console-card w-full max-w-md space-y-4 border border-console-line p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-console-line pb-3">
              <h2 id="join-workspace-title" className="text-lg font-bold text-console-ink">加入协作工作区</h2>
              <button
                type="button"
                aria-label="关闭加入弹窗"
                onClick={() => setShowJoinModal(false)}
                className="rounded-md p-1 text-console-ink-3 transition-colors hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {joinError && (
              <div
                role="alert"
                className="rounded-lg border border-console-danger/40 bg-console-danger/10 px-3 py-2 text-xs font-medium text-console-danger"
              >
                {joinError}
              </div>
            )}

            <form onSubmit={handleJoinSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="join-code">工作区邀请码</label>
                <input
                  id="join-code"
                  type="text"
                  required
                  autoFocus
                  placeholder="粘贴团队成员发给您的邀请码"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="w-full rounded-md border border-console-line-2 bg-console-surface-2 px-3 py-2 font-mono text-sm text-console-ink focus:border-console-accent focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="rounded-lg border border-console-line-2 px-4 py-2 text-sm font-medium text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-console-accent px-4 py-2 text-sm font-semibold text-console-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isSubmitting ? "加入中..." : "加入工作区"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile M3 Bottom Navigation Bar */}
      {activeItem !== "chats" ? (
        <nav
          aria-label="移动端导航"
          className="mobile-tab-bar fixed right-0 bottom-0 left-0 z-40 grid grid-cols-6 border-t border-console-line bg-console-sidebar/95 px-1 pt-2 text-console-ink-2 backdrop-blur-xl md:hidden"
        >
          {navigation.map((item) => {
            const Icon = item.icon
            const isActive = item.id === activeItem
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-center text-[11px] font-medium transition-all active:scale-95",
                  isActive ? "font-semibold text-console-accent" : "text-console-ink-3",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-200",
                    isActive ? "bg-console-active text-console-accent" : "text-console-ink-3",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      ) : null}

      {/* Logout confirm dialog (replaces native confirm) */}
      <ConfirmDialog
        open={showLogoutConfirm}
        title="退出登录"
        description="退出后将清除本地登录状态，需要重新登录才能继续使用工作区。"
        confirmLabel="退出登录"
        busy={isLoggingOut}
        onConfirm={() => void handleLogout()}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  )
}

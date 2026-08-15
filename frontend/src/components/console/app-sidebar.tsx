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
} from "lucide-react"

import { useWorkspaces } from "@/hooks/use-workspaces"
import { clearTokens } from "@/lib/auth"
import { cn } from "@/lib/utils"
import type { ConnectionStatus } from "@/types/agent"
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
}

export function AppSidebar({
  connectionStatus,
  activeItem = "console",
}: AppSidebarProps) {
  const router = useRouter()
  const {
    workspaces,
    activeWorkspace,
    currentUserRole,
    switchWorkspace,
    createWorkspace,
    joinWorkspace,
  } = useWorkspaces()

  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)

  const [newWsName, setNewWsName] = useState("")
  const [newWsDesc, setNewWsDesc] = useState("")
  const [joinCode, setJoinCode] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleLogout = () => {
    if (confirm("确定要退出登录吗？")) {
      clearTokens()
      router.push("/login")
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWsName.trim()) return
    setIsSubmitting(true)
    try {
      await createWorkspace(newWsName.trim(), newWsDesc.trim())
      setShowCreateModal(false)
      setNewWsName("")
      setNewWsDesc("")
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "创建工作区失败")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!joinCode.trim()) return
    setIsSubmitting(true)
    try {
      await joinWorkspace(joinCode.trim())
      setShowJoinModal(false)
      setJoinCode("")
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "加入工作区失败")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* Desktop M3 Navigation Rail */}
      <aside className="hidden min-h-svh flex-col items-center overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        {/* Top Logo & Workspace Trigger */}
        <div className="flex h-[72px] w-full flex-col items-center justify-center border-b border-sidebar-border/60 relative">
          <button
            type="button"
            onClick={() => setShowWorkspaceMenu((prev) => !prev)}
            title={`当前工作区: ${activeWorkspace?.name || "默认工作区"} (${ROLE_SHORT_LABELS[currentUserRole] || "成员"})`}
            className="group relative flex size-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-[0_2px_12px_color-mix(in_oklch,var(--primary)_20%,transparent)] transition-all duration-200 hover:scale-105 hover:bg-primary/20 active:scale-95"
          >
            <Sparkles aria-hidden="true" className="size-5 transition-transform duration-300 group-hover:rotate-12" />
            <span
              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-[var(--status-running)] shadow-[0_0_6px_var(--status-running)]"
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Navigation items */}
        <nav aria-label="主导航" className="flex flex-1 flex-col items-center gap-3 py-6">
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
                className={cn(
                  "group flex flex-col items-center gap-1 text-center transition-all duration-200 focus-visible:outline-none",
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200",
                    isActive
                      ? "bg-primary/22 text-primary shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
                      : "text-muted-foreground group-hover:bg-secondary/70 group-hover:text-foreground group-hover:scale-105 group-active:scale-95",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium transition-colors duration-200",
                    isActive ? "font-semibold text-primary" : "text-muted-foreground/90 group-hover:text-foreground",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Bottom User Actions & Status Dot */}
        <div className="flex flex-col items-center gap-2 py-4 border-t border-sidebar-border/60 w-full">
          <button
            type="button"
            onClick={handleLogout}
            title="退出登录"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
          >
            <LogOut className="size-4" />
          </button>

          <div
            className="flex h-8 w-full items-center justify-center"
            title={connectionStatus === "online" ? "实时通道已连接" : "实时通道未连接"}
          >
            <span className="status-dot size-2.5 rounded-full" data-status={connectionStatus} aria-hidden="true" />
          </div>
        </div>
      </aside>

      {/* Workspace Switcher Popover */}
      {showWorkspaceMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowWorkspaceMenu(false)}
          />
          <div className="fixed left-[76px] top-4 z-50 w-72 rounded-xl border border-border bg-card p-3 shadow-2xl space-y-2 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2 py-1.5 border-b border-border/60 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">我的协作工作区</span>
              <span className="text-[10px] font-mono rounded bg-secondary px-1.5 py-0.5 text-muted-foreground">
                {workspaces.length} 个
              </span>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1">
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
                      "w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      isCurrent
                        ? "bg-primary/15 text-primary font-medium"
                        : "hover:bg-secondary text-foreground"
                    )}
                  >
                    <div className="flex flex-col truncate pr-2">
                      <span className="truncate">{ws.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {ROLE_SHORT_LABELS[ws.role] || ws.role}
                      </span>
                    </div>
                    {isCurrent && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                )
              })}
            </div>

            <div className="pt-2 border-t border-border/60 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setShowWorkspaceMenu(false)
                  setShowCreateModal(true)
                }}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <Plus className="size-3.5" />
                创建新工作区
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowWorkspaceMenu(false)
                  setShowJoinModal(true)
                }}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <UserPlus className="size-3.5" />
                输入邀请码加入
              </button>

              <Link
                href="/settings/members"
                onClick={() => setShowWorkspaceMenu(false)}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <Users className="size-3.5" />
                成员与权限管理
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Create Workspace Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-lg font-bold">创建新协作工作区</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="ws-name">工作区名称</label>
                <input
                  id="ws-name"
                  type="text"
                  required
                  placeholder="如：智能体研发团队"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
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
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-lg font-bold">加入协作工作区</h2>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleJoinSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="join-code">工作区邀请码</label>
                <input
                  id="join-code"
                  type="text"
                  required
                  placeholder="粘贴团队成员发给您的邀请码"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground font-mono focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
          className="mobile-tab-bar fixed right-0 bottom-0 left-0 z-40 grid grid-cols-5 border-t border-sidebar-border/80 bg-sidebar/95 backdrop-blur-xl px-2 pt-2 text-sidebar-foreground md:hidden"
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
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-all active:scale-95",
                  isActive ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-all duration-200",
                    isActive ? "bg-primary/20 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      ) : null}
    </>
  )
}

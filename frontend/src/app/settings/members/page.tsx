"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Loader2,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { usePermissions } from "@/hooks/use-permissions"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { requestData } from "@/lib/task-api"
import type {
  InviteResult,
  WorkspaceMember,
  WorkspaceRole,
} from "@/types/membership"

const ROLE_LABELS: Record<WorkspaceRole, { label: string; color: string }> = {
  owner: { label: "所有者", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  admin: { label: "管理员", color: "bg-primary/15 text-primary border-primary/30" },
  member: { label: "成员", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  viewer: { label: "观察者", color: "bg-muted text-muted-foreground border-border" },
}

export default function MembersSettingsPage() {
  const { activeWorkspace, currentUserRole } = useWorkspaces()
  const permissions = usePermissions(currentUserRole)

  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modals state
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member")
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)
  const [isInviting, setIsInviting] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadedWorkspaceIdRef = useRef<number | null>(null)

  const loadMembers = useCallback(async (wsId: number) => {
    try {
      const data = await requestData<WorkspaceMember[]>(
        `/api/v1/workspaces/${wsId}/members`
      )
      setMembers(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "获取成员列表失败")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace) return
    if (loadedWorkspaceIdRef.current === activeWorkspace.id) return
    loadedWorkspaceIdRef.current = activeWorkspace.id
    void loadMembers(activeWorkspace.id)
  }, [activeWorkspace, loadMembers])

  const handleUpdateRole = async (userId: number, newRole: WorkspaceRole) => {
    if (!activeWorkspace) return
    try {
      await requestData(`/api/v1/workspaces/${activeWorkspace.id}/members/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      })
      await loadMembers(activeWorkspace.id)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "更新角色失败")
    }
  }

  const handleRemoveMember = async (userId: number) => {
    if (!activeWorkspace || !confirm("确定要将该成员从工作区移除吗？")) return
    try {
      await requestData(`/api/v1/workspaces/${activeWorkspace.id}/members/${userId}`, {
        method: "DELETE",
      })
      await loadMembers(activeWorkspace.id)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "移除成员失败")
    }
  }

  const handleCreateInvite = async () => {
    if (!activeWorkspace) return
    setIsInviting(true)
    try {
      const result = await requestData<InviteResult>(
        `/api/v1/workspaces/${activeWorkspace.id}/members/invite`,
        {
          method: "POST",
          body: JSON.stringify({ role: inviteRole }),
        }
      )
      setInviteResult(result)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "生成邀请码失败")
    } finally {
      setIsInviting(false)
    }
  }

  const handleCopyCode = () => {
    if (!inviteResult) return
    navigator.clipboard.writeText(inviteResult.invite_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar connectionStatus="online" activeItem="settings" />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Link
                  href="/settings"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                <h1 className="text-2xl font-bold tracking-tight">成员与权限管理</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                当前工作区：
                <span className="font-semibold text-foreground">
                  {activeWorkspace?.name || "加载中..."}
                </span>{" "}
                · 您的身份：
                <span className="font-medium text-primary">
                  {ROLE_LABELS[currentUserRole]?.label || currentUserRole}
                </span>
              </p>
            </div>

            {permissions.canInvite && (
              <button
                type="button"
                onClick={() => {
                  setInviteResult(null)
                  setShowInviteModal(true)
                }}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all active:scale-95 shadow-sm"
              >
                <UserPlus className="h-4 w-4" />
                邀请成员
              </button>
            )}
          </div>

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Members Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border/60 flex items-center justify-between bg-card/60">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">工作区成员列表</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground font-mono">
                  {members.length}
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : members.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无成员信息
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border/40 bg-secondary/30 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-6 py-3 font-semibold">用户</th>
                      <th className="px-6 py-3 font-semibold">邮箱</th>
                      <th className="px-6 py-3 font-semibold">角色权限</th>
                      <th className="px-6 py-3 font-semibold">加入时间</th>
                      <th className="px-6 py-3 font-semibold text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {members.map((m) => {
                      const roleConfig = ROLE_LABELS[m.role] || ROLE_LABELS.viewer
                      const isTargetOwner = m.role === "owner"

                      return (
                        <tr key={m.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                                {m.display_name.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="font-medium text-foreground">
                                {m.display_name}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                            {m.email}
                          </td>
                          <td className="px-6 py-4">
                            {permissions.canManageMembers && !isTargetOwner ? (
                              <select
                                value={m.role}
                                onChange={(e) =>
                                  handleUpdateRole(m.user_id, e.target.value as WorkspaceRole)
                                }
                                className="rounded-md border border-border bg-input px-2.5 py-1 text-xs font-medium focus:border-primary focus:outline-none"
                              >
                                <option value="admin">管理员 (Admin)</option>
                                <option value="member">成员 (Member)</option>
                                <option value="viewer">观察者 (Viewer)</option>
                              </select>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${roleConfig.color}`}
                              >
                                {m.role === "owner" && <Crown className="h-3 w-3" />}
                                {m.role === "admin" && <Shield className="h-3 w-3" />}
                                {roleConfig.label}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-muted-foreground">
                            {new Date(m.joined_at).toLocaleDateString("zh-CN")}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {permissions.canManageMembers && !isTargetOwner && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m.user_id)}
                                className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                                title="移除成员"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-lg font-bold">邀请成员加入工作区</h2>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            {!inviteResult ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">指定成员角色</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  >
                    <option value="admin">管理员（可管理成员与模型设置）</option>
                    <option value="member">成员（可创建任务与参与群聊）</option>
                    <option value="viewer">观察者（只读浏览）</option>
                  </select>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={isInviting}
                    onClick={handleCreateInvite}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isInviting && <Loader2 className="h-4 w-4 animate-spin" />}
                    生成邀请码
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/80 bg-secondary/50 p-4 space-y-2">
                  <span className="text-xs text-muted-foreground">工作区专属邀请码（7天有效）：</span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base font-bold text-primary break-all">
                      {inviteResult.invite_code}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="flex items-center gap-1 rounded-md bg-primary/20 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/30 transition-colors shrink-0"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "已复制" : "复制"}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  受邀成员登录后，点击左侧工作区切换器中的「加入工作区」并输入此码即可。
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                  >
                    完成
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

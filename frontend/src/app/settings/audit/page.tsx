"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { requestData } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type { AuditLogItem, AuditLogListResponse } from "@/types/audit"

const ACTION_MAP: Record<string, { label: string; color: string; category: string }> = {
  "user.register": { label: "用户注册", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", category: "auth" },
  "user.login": { label: "用户登录", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", category: "auth" },
  "member.invite": { label: "邀请成员", color: "bg-primary/15 text-primary border-primary/30", category: "member" },
  "member.join": { label: "成员加入", color: "bg-teal-500/15 text-teal-400 border-teal-500/30", category: "member" },
  "member.role_update": { label: "变更权限", color: "bg-amber-500/15 text-amber-400 border-amber-500/30", category: "member" },
  "member.remove": { label: "移除成员", color: "bg-destructive/15 text-destructive border-destructive/30", category: "member" },
  "provider_key.update": { label: "更新密钥", color: "bg-purple-500/15 text-purple-400 border-purple-500/30", category: "key" },
  "provider_key.delete": { label: "删除密钥", color: "bg-destructive/15 text-destructive border-destructive/30", category: "key" },
  "task.create": { label: "创建任务", color: "bg-sky-500/15 text-sky-400 border-sky-500/30", category: "task" },
  "task.cancel": { label: "取消任务", color: "bg-orange-500/15 text-orange-400 border-orange-500/30", category: "task" },
}

export default function AuditLogsPage() {
  const { activeWorkspace } = useWorkspaces()
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const limit = 20

  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [actionFilter, setActionFilter] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null)

  const loadedParamsRef = useRef<string>("")

  const loadAuditLogs = useCallback(
    async (wsId: number, currentOffset: number, action: string) => {
      setIsLoading(true)
      setError(null)
      try {
        let url = `/api/v1/workspaces/${wsId}/audit-logs?offset=${currentOffset}&limit=${limit}`
        if (action) url += `&action=${encodeURIComponent(action)}`
        const res = await requestData<AuditLogListResponse>(url)
        setLogs(res.items)
        setTotal(res.total)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "获取审计日志失败")
      } finally {
        setIsLoading(false)
      }
    },
    [limit]
  )

  useEffect(() => {
    if (!activeWorkspace) return
    const key = `${activeWorkspace.id}-${offset}-${actionFilter}`
    if (loadedParamsRef.current === key) return
    loadedParamsRef.current = key
    void loadAuditLogs(activeWorkspace.id, offset, actionFilter)
  }, [activeWorkspace, offset, actionFilter, loadAuditLogs])

  const handleRefresh = () => {
    if (!activeWorkspace) return
    void loadAuditLogs(activeWorkspace.id, offset, actionFilter)
  }

  const filteredLogs = logs.filter((log) => {
    if (categoryFilter === "all") return true
    const config = ACTION_MAP[log.action]
    return config?.category === categoryFilter
  })

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar connectionStatus="online" activeItem="settings" />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
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
                <h1 className="text-2xl font-bold tracking-tight">平台操作审计日志</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                当前工作区：
                <span className="font-semibold text-foreground">
                  {activeWorkspace?.name || "默认工作区"}
                </span>{" "}
                · 记录所有重要安全、权限与业务变更
              </p>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-secondary transition-colors"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin text-primary")} />
              刷新日志
            </button>
          </div>

          {/* Categories Filter Tabs & Action Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: "all", label: "全部操作" },
                { id: "auth", label: "用户认证" },
                { id: "member", label: "成员管理" },
                { id: "key", label: "模型密钥" },
                { id: "task", label: "任务调度" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setCategoryFilter(tab.id)
                    setOffset(0)
                  }}
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                    categoryFilter === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-secondary/70 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value)
                  setOffset(0)
                }}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">全部动作细分</option>
                {Object.entries(ACTION_MAP).map(([act, info]) => (
                  <option key={act} value={act}>
                    {info.label} ({act})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Logs Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border/60 flex items-center justify-between bg-card/60">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">审计事件流</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground font-mono">
                  共 {total} 条记录
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="flex h-56 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                暂无匹配的审计操作记录
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border/40 bg-secondary/30 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-6 py-3 font-semibold">事件时间</th>
                      <th className="px-6 py-3 font-semibold">操作人</th>
                      <th className="px-6 py-3 font-semibold">动作类型</th>
                      <th className="px-6 py-3 font-semibold">目标资源</th>
                      <th className="px-6 py-3 font-semibold">IP 地址</th>
                      <th className="px-6 py-3 font-semibold text-right">明细</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {filteredLogs.map((log) => {
                      const actionInfo = ACTION_MAP[log.action] || {
                        label: log.action,
                        color: "bg-muted text-muted-foreground border-border",
                      }

                      return (
                        <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleString("zh-CN")}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">
                                {(log.user_display_name || "S").slice(0, 1).toUpperCase()}
                              </div>
                              <span className="text-xs font-medium text-foreground">
                                {log.user_display_name || "系统操作"}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${actionInfo.color}`}
                            >
                              {actionInfo.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs font-mono text-muted-foreground">
                            {log.resource_type} {log.resource_id ? `#${log.resource_id}` : ""}
                          </td>
                          <td className="px-6 py-4 text-xs font-mono text-muted-foreground">
                            {log.ip_address || "-"}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {log.detail ? (
                              <button
                                type="button"
                                onClick={() => setSelectedLog(log)}
                                className="rounded px-2 py-1 text-xs text-primary hover:bg-primary/10 font-medium transition-colors"
                              >
                                查看详情
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between border-t border-border/60 p-4 text-xs text-muted-foreground">
                <span>
                  显示 {offset + 1} - {Math.min(offset + limit, total)} 条，共 {total} 条
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={offset === 0}
                    onClick={() => setOffset((prev) => Math.max(0, prev - limit))}
                    className="rounded border border-border bg-secondary/50 px-3 py-1 font-medium hover:bg-secondary disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset((prev) => prev + limit)}
                    className="rounded border border-border bg-secondary/50 px-3 py-1 font-medium hover:bg-secondary disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <h2 className="text-base font-bold">审计详情 #{selectedLog.id}</h2>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary/40 p-3">
                <div>
                  <span className="text-muted-foreground">操作动作：</span>
                  <span className="font-semibold text-foreground ml-1">
                    {ACTION_MAP[selectedLog.action]?.label || selectedLog.action}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">时间：</span>
                  <span className="font-mono text-foreground ml-1">
                    {new Date(selectedLog.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>

              <div>
                <span className="font-semibold text-muted-foreground mb-1 block">Payload 明细：</span>
                <pre className="max-h-60 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-[11px] text-primary">
                  {JSON.stringify(selectedLog.detail, null, 2)}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

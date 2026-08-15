"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Coins,
  DollarSign,
  Gauge,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldAlert,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { usePermissions } from "@/hooks/use-permissions"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { formatCost, formatTokens } from "@/lib/task-format"
import { requestData } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type { QuotaUsage } from "@/types/quota"

export default function QuotaSettingsPage() {
  const { activeWorkspace } = useWorkspaces()
  const { isAdmin } = usePermissions()

  const [usage, setUsage] = useState<QuotaUsage | null>(null)
  const [budgetUsd, setBudgetUsd] = useState<number>(100)
  const [tokenLimit, setTokenLimit] = useState<number>(10_000_000)
  const [maxConcurrent, setMaxConcurrent] = useState<number>(5)
  const [rateLimit, setRateLimit] = useState<number>(60)
  const [isHardLimit, setIsHardLimit] = useState<boolean>(false)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const loadedIdRef = useRef<number | null>(null)

  const loadQuota = useCallback(async (wsId: number) => {
    setIsLoading(true)
    setMessage(null)
    try {
      const data = await requestData<QuotaUsage>(`/api/v1/workspaces/${wsId}/quota`)
      setUsage(data)
      setBudgetUsd(data.budget_usd)
      setTokenLimit(data.token_limit)
      setMaxConcurrent(data.max_concurrent_tasks)
      setIsHardLimit(data.is_hard_limit)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "获取配额失败" })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace) return
    if (loadedIdRef.current === activeWorkspace.id) return
    loadedIdRef.current = activeWorkspace.id
    void loadQuota(activeWorkspace.id)
  }, [activeWorkspace, loadQuota])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace || !isAdmin) return
    setIsSaving(true)
    setMessage(null)
    try {
      await requestData(`/api/v1/workspaces/${activeWorkspace.id}/quota`, {
        method: "PUT",
        body: JSON.stringify({
          monthly_budget_usd: Number(budgetUsd),
          max_monthly_tokens: Number(tokenLimit),
          max_concurrent_tasks: Number(maxConcurrent),
          rate_limit_per_minute: Number(rateLimit),
          is_hard_limit: isHardLimit,
        }),
      })
      setMessage({ type: "success", text: "工作区配额与限流规则已成功更新" })
      void loadQuota(activeWorkspace.id)
    } catch (err: unknown) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "保存配额失败" })
    } finally {
      setIsSaving(false)
    }
  }

  const percentSpent = usage?.percent_spent || 0
  const isExceeded = usage?.is_exceeded || false

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AppSidebar connectionStatus="online" activeItem="settings" />

      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="mx-auto max-w-4xl space-y-6">
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
                <h1 className="text-2xl font-bold tracking-tight">工作区配额与限流治理</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                当前工作区：
                <span className="font-semibold text-foreground">
                  {activeWorkspace?.name || "默认工作区"}
                </span>{" "}
                · 预算管控、Token 水位限制与并发熔断保护
              </p>
            </div>

            <button
              type="button"
              onClick={() => activeWorkspace && loadQuota(activeWorkspace.id)}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium hover:bg-secondary transition-colors"
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin text-primary")} />
              刷新状态
            </button>
          </div>

          {/* Feedback message banner */}
          {message && (
            <div
              className={cn(
                "rounded-xl border p-4 text-sm font-medium animate-in fade-in duration-150",
                message.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                  : "border-destructive/30 bg-destructive/15 text-destructive"
              )}
            >
              {message.text}
            </div>
          )}

          {/* Watermark Meter Card */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2.5">
                <Gauge className="size-5 text-primary" />
                <h2 className="text-sm font-bold text-foreground">本月额度消耗水位</h2>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-mono font-bold",
                  percentSpent > 100
                    ? "bg-destructive/20 text-destructive"
                    : percentSpent > 80
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-emerald-500/20 text-emerald-400"
                )}
              >
                已用 {percentSpent}%
              </span>
            </div>

            {/* Gauge Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-muted-foreground">
                  已消耗：
                  <strong className="text-foreground font-semibold">
                    {formatCost(usage?.monthly_spent_usd || 0)}
                  </strong>
                </span>
                <span className="text-muted-foreground">
                  月度预算：
                  <strong className="text-foreground font-semibold">
                    {formatCost(usage?.budget_usd || 100)}
                  </strong>
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  style={{ width: `${Math.min(percentSpent, 100)}%` }}
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    percentSpent > 100
                      ? "bg-destructive"
                      : percentSpent > 80
                      ? "bg-amber-500"
                      : "bg-primary"
                  )}
                />
              </div>
            </div>

            {/* Token & Concurrent Sub-stats */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
              <div className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3.5">
                <Coins className="size-5 text-amber-400 shrink-0" />
                <div className="text-xs space-y-0.5">
                  <div className="text-muted-foreground">本月 Token 消耗</div>
                  <div className="font-mono font-bold text-foreground">
                    {formatTokens(usage?.monthly_tokens_used || 0)} / {formatTokens(usage?.token_limit || 10000000)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-xl bg-secondary/40 p-3.5">
                <Layers className="size-5 text-sky-400 shrink-0" />
                <div className="text-xs space-y-0.5">
                  <div className="text-muted-foreground">最大并发调度任务</div>
                  <div className="font-mono font-bold text-foreground">
                    {usage?.max_concurrent_tasks || 5} 个独立任务
                  </div>
                </div>
              </div>
            </div>

            {isExceeded && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <ShieldAlert className="size-4 shrink-0" />
                <span>
                  当前工作区本月算力消耗已超出设定限额。{isHardLimit ? "硬熔断机制已生效，将拒绝新建任务。" : "当前仅触发提醒，未启用强制熔断。"}
                </span>
              </div>
            )}
          </div>

          {/* Quota Settings Form */}
          <form onSubmit={handleSave} className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2.5">
                <DollarSign className="size-5 text-primary" />
                <h2 className="text-sm font-bold text-foreground">配额与限流规则配置</h2>
              </div>
              {!isAdmin && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3" /> 仅管理员可编辑
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  月度消费预算上限 (USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!isAdmin}
                  value={budgetUsd}
                  onChange={(e) => setBudgetUsd(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  用于计算消耗百分比与触发额度预警
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  月度 Token 消耗上限
                </label>
                <input
                  type="number"
                  step="100000"
                  min="0"
                  disabled={!isAdmin}
                  value={tokenLimit}
                  onChange={(e) => setTokenLimit(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  工作区大模型调用的累计 Token 阈值
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  最大并发执行任务数
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  disabled={!isAdmin}
                  value={maxConcurrent}
                  onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  限制工作区同时处于 Running 状态的任务数量
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  API 请求速率限制 (次/分钟)
                </label>
                <input
                  type="number"
                  min="10"
                  max="1000"
                  disabled={!isAdmin}
                  value={rateLimit}
                  onChange={(e) => setRateLimit(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                />
                <p className="text-[11px] text-muted-foreground">
                  防止单工作区短时间高频请求造成算力过载
                </p>
              </div>
            </div>

            {/* Hard Limit Switch */}
            <div className="flex items-center justify-between rounded-xl border border-border/80 bg-secondary/30 p-4">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-foreground">开启硬熔断保护</div>
                <div className="text-[11px] text-muted-foreground">
                  当月度支出或 Token 超标时，直接拒绝创建新任务，杜绝意外超额账单
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={isHardLimit}
                onChange={(e) => setIsHardLimit(e.target.checked)}
                className="size-5 accent-primary cursor-pointer disabled:opacity-50"
              />
            </div>

            {isAdmin && (
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存配额配置
                </button>
              </div>
            )}
          </form>
        </div>
      </main>
    </div>
  )
}

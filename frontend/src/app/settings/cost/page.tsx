"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Activity,
  ArrowLeft,
  Coins,
  DollarSign,
  ExternalLink,
  Flame,
  Layers,
  PieChart,
  RefreshCw,
  TrendingUp,
} from "lucide-react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { formatCost, formatTokens } from "@/lib/task-format"
import { requestData } from "@/lib/task-api"
import { cn } from "@/lib/utils"
import type {
  CostSummary,
  DailyCostItem,
  ModelCostItem,
  TopTaskCostItem,
} from "@/types/cost"

export default function CostDashboardPage() {
  const { activeWorkspace } = useWorkspaces()
  const [days, setDays] = useState<number>(30)

  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [dailyTrend, setDailyTrend] = useState<DailyCostItem[]>([])
  const [models, setModels] = useState<ModelCostItem[]>([])
  const [topTasks, setTopTasks] = useState<TopTaskCostItem[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadedKeyRef = useRef<string>("")

  const loadCostData = useCallback(async (wsId: number, rangeDays: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const [sum, trend, byModel, tasks] = await Promise.all([
        requestData<CostSummary>(`/api/v1/workspaces/${wsId}/cost/summary`),
        requestData<DailyCostItem[]>(`/api/v1/workspaces/${wsId}/cost/daily-trend?days=${rangeDays}`),
        requestData<ModelCostItem[]>(`/api/v1/workspaces/${wsId}/cost/by-model`),
        requestData<TopTaskCostItem[]>(`/api/v1/workspaces/${wsId}/cost/top-tasks?limit=10`),
      ])
      setSummary(sum)
      setDailyTrend(trend)
      setModels(byModel)
      setTopTasks(tasks)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "获取成本数据失败")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace) return
    const key = `${activeWorkspace.id}-${days}`
    if (loadedKeyRef.current === key) return
    loadedKeyRef.current = key
    void loadCostData(activeWorkspace.id, days)
  }, [activeWorkspace, days, loadCostData])

  const handleRefresh = () => {
    if (!activeWorkspace) return
    void loadCostData(activeWorkspace.id, days)
  }

  // Calculate max cost for bar scaling
  const maxDailyCost = Math.max(...dailyTrend.map((d) => d.cost_usd), 0.01)

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
                <h1 className="text-2xl font-bold tracking-tight">成本中心与 Token 统计</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                当前工作区：
                <span className="font-semibold text-foreground">
                  {activeWorkspace?.name || "默认工作区"}
                </span>{" "}
                · 大模型调用算力消耗与费用分析
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setDays(7)}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium transition-colors",
                    days === 7 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  近 7 天
                </button>
                <button
                  type="button"
                  onClick={() => setDays(30)}
                  className={cn(
                    "rounded-md px-3 py-1 font-medium transition-colors",
                    days === 30 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  近 30 天
                </button>
              </div>

              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm font-medium hover:bg-secondary transition-colors"
                title="刷新数据"
              >
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin text-primary")} />
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/15 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* 4 Metric Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">本月总支出</span>
                <DollarSign className="size-4 text-primary" />
              </div>
              <div className="text-2xl font-bold text-foreground font-mono">
                {formatCost(summary?.month_cost_usd || 0)}
              </div>
              <p className="text-[11px] text-muted-foreground">
                今日：<span className="font-mono text-foreground font-semibold">{formatCost(summary?.today_cost_usd || 0)}</span>
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">累计消耗 Token</span>
                <Coins className="size-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-foreground font-mono">
                {formatTokens(summary?.total_tokens || 0)}
              </div>
              <p className="text-[11px] text-muted-foreground">
                总费用：<span className="font-mono text-foreground font-semibold">{formatCost(summary?.total_cost_usd || 0)}</span>
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">模型调用总次数</span>
                <Layers className="size-4 text-sky-400" />
              </div>
              <div className="text-2xl font-bold text-foreground font-mono">
                {summary?.total_calls.toLocaleString() || 0}
              </div>
              <p className="text-[11px] text-muted-foreground">已成功完成全部编排</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">平均调用响应耗时</span>
                <Activity className="size-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-foreground font-mono">
                {summary?.avg_latency_ms || 0} <span className="text-xs font-normal text-muted-foreground">ms</span>
              </div>
              <p className="text-[11px] text-muted-foreground">端到端 LiteLLM 延迟</p>
            </div>
          </div>

          {/* Daily Trend & Model Distribution Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Daily Trend Bar Chart (2 cols) */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  <span className="text-sm font-semibold">每日调用费用趋势</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">近 {days} 天</span>
              </div>

              {dailyTrend.length === 0 ? (
                <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
                  所选周期内暂无调用数据
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex h-52 items-end gap-1.5 pt-6 pb-2 overflow-x-auto">
                    {dailyTrend.map((d) => {
                      const heightPercent = Math.max(8, Math.round((d.cost_usd / maxDailyCost) * 100))
                      return (
                        <div
                          key={d.date}
                          className="group relative flex flex-1 min-w-[20px] flex-col items-center gap-1"
                        >
                          {/* Tooltip on hover */}
                          <div className="absolute -top-12 z-20 hidden rounded-md border border-border bg-popover px-2.5 py-1 text-[10px] text-popover-foreground shadow-lg group-hover:block whitespace-nowrap">
                            <div className="font-semibold">{d.date}</div>
                            <div>费用: {formatCost(d.cost_usd)}</div>
                            <div>Tokens: {formatTokens(d.total_tokens)}</div>
                          </div>

                          <div
                            style={{ height: `${heightPercent}%` }}
                            className="w-full rounded-t-md bg-primary/70 group-hover:bg-primary transition-all duration-200"
                          />
                          <span className="text-[9px] font-mono text-muted-foreground truncate w-full text-center">
                            {d.date.slice(5)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Model Breakdown (1 col) */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div className="flex items-center gap-2">
                  <PieChart className="size-4 text-amber-400" />
                  <span className="text-sm font-semibold">模型消耗分布</span>
                </div>
                <span className="text-xs text-muted-foreground">{models.length} 个模型</span>
              </div>

              {models.length === 0 ? (
                <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
                  暂无模型消耗数据
                </div>
              ) : (
                <div className="space-y-4 max-h-60 overflow-y-auto pr-1">
                  {models.map((m) => (
                    <div key={`${m.provider}-${m.model_name}`} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground truncate max-w-[140px]" title={m.model_name}>
                          {m.model_name}
                        </span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-muted-foreground">{formatCost(m.cost_usd)}</span>
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            {m.percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          style={{ width: `${m.percentage}%` }}
                          className="h-full rounded-full bg-primary"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top Cost Tasks Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden space-y-0">
            <div className="p-4 border-b border-border/60 flex items-center justify-between bg-card/60">
              <div className="flex items-center gap-2">
                <Flame className="size-4 text-orange-400" />
                <span className="font-semibold text-sm">算力与费用消耗 Top 任务</span>
              </div>
              <span className="text-xs text-muted-foreground">按模型累计费用倒序</span>
            </div>

            {topTasks.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                暂无任务调用明细
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/40 bg-secondary/30 text-muted-foreground uppercase">
                    <tr>
                      <th className="px-6 py-3 font-semibold">任务 ID</th>
                      <th className="px-6 py-3 font-semibold">任务标题</th>
                      <th className="px-6 py-3 font-semibold">状态</th>
                      <th className="px-6 py-3 font-semibold">模型调用次数</th>
                      <th className="px-6 py-3 font-semibold">总 Token</th>
                      <th className="px-6 py-3 font-semibold text-right">总支出 ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30 font-mono">
                    {topTasks.map((task) => (
                      <tr key={task.task_id} className="hover:bg-secondary/20 transition-colors">
                        <td className="px-6 py-3.5 font-bold text-primary">
                          <Link
                            href={`/tasks/${task.task_id}`}
                            className="flex items-center gap-1 hover:underline"
                          >
                            #{task.task_id}
                            <ExternalLink className="size-3" />
                          </Link>
                        </td>
                        <td className="px-6 py-3.5 font-sans font-medium text-foreground max-w-xs truncate">
                          {task.task_title}
                        </td>
                        <td className="px-6 py-3.5">
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-sans">
                            {task.status}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-muted-foreground">
                          {task.model_call_count} 次
                        </td>
                        <td className="px-6 py-3.5 text-foreground">
                          {formatTokens(task.total_tokens)}
                        </td>
                        <td className="px-6 py-3.5 text-right font-bold text-primary">
                          {formatCost(task.cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

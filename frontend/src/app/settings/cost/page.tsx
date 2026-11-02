"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import Link from "next/link"
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Coins,
  DollarSign,
  ExternalLink,
  Flame,
  Layers,
  Minus,
  RefreshCw,
  TrendingUp,
} from "@/components/ui/icons"

import { AppSidebar } from "@/components/console/app-sidebar"
import { SegmentedControl } from "@/components/settings/segmented-control"
import { EmptyState, InlineError, SkeletonRows } from "@/components/ui/feedback"
import { useWorkspaceConnection } from "@/hooks/use-workspace-connection"
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

const DAY_MS = 86_400_000

const RANGES = [
  { id: "24h", label: "24h", days: 1, capped: false },
  { id: "7d", label: "7d", days: 7, capped: false },
  { id: "30d", label: "30d", days: 30, capped: false },
  // 后端 daily-trend 单次查询上限 90 天（ge=1 le=90），12m 视图展示近 90 天
  { id: "12m", label: "12m", days: 90, capped: true },
] as const

type RangeId = (typeof RANGES)[number]["id"]

const RANGE_OPTIONS = RANGES.map((item) => ({ value: item.id, label: item.label }))

const RANKING_OPTIONS = [
  { value: "models", label: "按模型" },
  { value: "tasks", label: "按任务" },
] as const

type RankingMode = (typeof RANKING_OPTIONS)[number]["value"]

interface DayBucket {
  date: string
  prompt: number
  completion: number
  cost: number
  calls: number
}

const isoDay = (timestamp: number) => {
  const date = new Date(timestamp)
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return date.getUTCFullYear() + "-" + month + "-" + day
}

const shortDate = (date: string) => date.slice(5)

const formatCostCompact = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return "$0"
  if (Math.abs(value) >= 1) return "$" + value.toFixed(2)
  if (Math.abs(value) >= 0.01) return "$" + value.toFixed(4)
  return "$" + value.toFixed(6)
}

const formatDelta = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "—"
  const sign = value > 0 ? "+" : ""
  return sign + value.toFixed(1) + "%"
}

export default function CostDashboardPage() {
  const { activeWorkspace } = useWorkspaces()
  const connectionStatus = useWorkspaceConnection(activeWorkspace?.id ?? null)

  const [range, setRange] = useState<RangeId>("30d")
  const [rankingMode, setRankingMode] = useState<RankingMode>("models")

  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [dailyTrend, setDailyTrend] = useState<DailyCostItem[]>([])
  const [models, setModels] = useState<ModelCostItem[]>([])
  const [topTasks, setTopTasks] = useState<TopTaskCostItem[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadedKeyRef = useRef<string>("")

  const rangeConfig = useMemo(
    () => RANGES.find((item) => item.id === range) ?? RANGES[2],
    [range],
  )
  // 环比需要上一周期数据：一次拉取两倍范围（服务端上限 90 天）
  const fetchDays = Math.min(rangeConfig.days * 2, 90)
  const windowDays = Math.min(rangeConfig.days, 90)

  const loadCostData = useCallback(async (wsId: number, rangeDays: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const [sum, trend, byModel, tasks] = await Promise.all([
        requestData<CostSummary>("/api/v1/workspaces/" + wsId + "/cost/summary"),
        requestData<DailyCostItem[]>(
          "/api/v1/workspaces/" +
            wsId +
            "/cost/daily-trend?days=" +
            rangeDays,
        ),
        requestData<ModelCostItem[]>(
          "/api/v1/workspaces/" + wsId + "/cost/by-model",
        ),
        requestData<TopTaskCostItem[]>(
          "/api/v1/workspaces/" + wsId + "/cost/top-tasks?limit=10",
        ),
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
    const key = activeWorkspace.id + "-" + fetchDays
    if (loadedKeyRef.current === key) return
    loadedKeyRef.current = key
    void loadCostData(activeWorkspace.id, fetchDays)
  }, [activeWorkspace, fetchDays, loadCostData])

  const handleRefresh = () => {
    if (!activeWorkspace) return
    void loadCostData(activeWorkspace.id, fetchDays)
  }

  /* ---------------- 范围聚合：按天分桶、环比与堆叠柱 ---------------- */

  const analytics = useMemo(() => {
    const byDate = new Map<string, DailyCostItem>()
    for (const item of dailyTrend) {
      byDate.set(item.date, item)
    }
    const now = new Date()
    const todayUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    )
    const allDays: DayBucket[] = []
    for (let offset = fetchDays - 1; offset >= 0; offset -= 1) {
      const date = isoDay(todayUtc - offset * DAY_MS)
      const item = byDate.get(date)
      allDays.push({
        date,
        prompt: item?.prompt_tokens ?? 0,
        completion: item?.completion_tokens ?? 0,
        cost: item?.cost_usd ?? 0,
        calls: item?.call_count ?? 0,
      })
    }

    const chartBuckets =
      range === "24h" ? allDays.slice(-2) : allDays.slice(-windowDays)
    const currentBuckets =
      range === "24h" ? allDays.slice(-1) : chartBuckets
    const previousBuckets =
      range === "24h"
        ? allDays.slice(-2, -1)
        : allDays.slice(0, Math.max(allDays.length - windowDays, 0))

    const sumTokens = (buckets: DayBucket[]) =>
      buckets.reduce(
        (total, bucket) => total + bucket.prompt + bucket.completion,
        0,
      )
    const currentTotal = sumTokens(currentBuckets)
    const previousTotal =
      previousBuckets.length > 0 ? sumTokens(previousBuckets) : null
    const deltaPercent =
      previousTotal !== null && previousTotal > 0
        ? ((currentTotal - previousTotal) / previousTotal) * 100
        : null
    const maxTotal = chartBuckets.reduce(
      (max, bucket) => Math.max(max, bucket.prompt + bucket.completion),
      0,
    )

    return {
      chartBuckets,
      currentTotal,
      previousTotal,
      deltaPercent,
      maxTotal,
      hasData: maxTotal > 0,
      capped: rangeConfig.capped,
    }
  }, [dailyTrend, fetchDays, range, rangeConfig.capped, windowDays])

  /* ---------------- 排行行：按模型 / 按任务 ---------------- */

  const rankingItems = useMemo(() => {
    if (rankingMode === "models") {
      return models.slice(0, 5).map((item, index) => ({
        key: item.provider + "-" + item.model_name,
        rank: index + 1,
        glyph: (item.model_name.charAt(0) || "M").toUpperCase(),
        name: item.model_name,
        subtitle:
          item.provider +
          " · " +
          formatTokens(item.token_count) +
          " Token · " +
          item.call_count +
          " 次调用",
        value: formatCostCompact(item.cost_usd),
        percent: Math.max(0, Math.min(100, item.percentage)),
        href: null as string | null,
      }))
    }
    const totalTaskCost =
      topTasks.reduce((total, task) => total + task.cost_usd, 0) || 1
    return topTasks.slice(0, 5).map((task, index) => ({
      key: "task-" + task.task_id,
      rank: index + 1,
      glyph: "#" + (index + 1),
      name: task.task_title,
      subtitle:
        "#" +
        task.task_id +
        " · " +
        task.status +
        " · " +
        task.model_call_count +
        " 次调用",
      value: formatCostCompact(task.cost_usd),
      percent: Math.max(0, Math.min(100, (task.cost_usd / totalTaskCost) * 100)),
      href: "/tasks/" + task.task_id,
    }))
  }, [models, rankingMode, topTasks])

  const rankingEmpty = rankingItems.length === 0
  const deltaPositive = (analytics.deltaPercent ?? 0) > 0
  const deltaNegative = (analytics.deltaPercent ?? 0) < 0
  const rangeCaption =
    range === "24h"
      ? "按自然日聚合，环比对照前一自然日"
      : analytics.capped
        ? "服务端单次查询上限 90 天，12m 视图展示近 90 天"
        : "按天堆叠，环比对照上一周期"

  const deltaChip = (
    <span
      title={"较上一周期 " + formatDelta(analytics.deltaPercent)}
      className={cn(
        "console-pill console-tabular inline-flex h-9 items-center gap-1 px-3 text-[11px] font-medium",
        analytics.deltaPercent === null
          ? "text-console-ink-3"
          : deltaPositive
            ? "text-console-success"
            : deltaNegative
              ? "text-console-danger"
              : "text-console-ink-3",
      )}
    >
      {analytics.deltaPercent === null ? null : deltaPositive ? (
        <ArrowUpRight aria-hidden="true" className="size-3" />
      ) : deltaNegative ? (
        <ArrowDownRight aria-hidden="true" className="size-3" />
      ) : (
        <Minus aria-hidden="true" className="size-3" />
      )}
      较上一周期 {formatDelta(analytics.deltaPercent)}
    </span>
  )

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-clip md:grid-cols-[auto_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="settings" />

      <main className="console-main min-w-0 px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
        <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5">
          {/* Header */}
          <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <Link
                href="/settings"
                aria-label="返回设置中心"
                className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-console-ink-3 transition-colors hover:bg-console-hover hover:text-console-ink"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
              </Link>
              <div className="min-w-0">
                <p className="console-section-title">设置 · 成本</p>
                <h1 className="truncate text-[1.4rem] leading-8 font-bold tracking-[-0.02em] text-console-ink">
                  成本中心与 Token 统计
                </h1>
                <p className="mt-0.5 text-[13px] leading-[18px] text-console-ink-3">
                  当前工作区：
                  <span className="font-medium text-console-ink">
                    {activeWorkspace?.name || "默认工作区"}
                  </span>{" "}
                  · 大模型调用算力消耗与费用分析
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                ariaLabel="统计范围"
                options={RANGE_OPTIONS}
                value={range}
                onChange={(next) => setRange(next)}
              />
              <button
                type="button"
                onClick={handleRefresh}
                title="刷新数据"
                aria-label="刷新数据"
                className="console-pill flex size-9 items-center justify-center text-console-ink-2 transition-colors hover:bg-console-hover hover:text-console-ink disabled:opacity-50"
                disabled={isLoading}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("size-4", isLoading && "animate-spin text-console-accent")}
                />
              </button>
              {deltaChip}
            </div>
          </header>

          {error ? <InlineError message={error} onRetry={handleRefresh} /> : null}

          {/* 概览指标 */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard
              label="本月总支出"
              value={formatCost(summary?.month_cost_usd || 0)}
              hint={
                <>
                  今日{" "}
                  <span className="console-tabular font-medium text-console-ink-2">
                    {formatCost(summary?.today_cost_usd || 0)}
                  </span>
                </>
              }
              icon={<DollarSign aria-hidden="true" className="size-4 text-console-accent" />}
            />
            <MetricCard
              label="累计消耗 Token"
              value={formatTokens(summary?.total_tokens || 0)}
              hint={
                <>
                  总费用{" "}
                  <span className="console-tabular font-medium text-console-ink-2">
                    {formatCost(summary?.total_cost_usd || 0)}
                  </span>
                </>
              }
              icon={<Coins aria-hidden="true" className="size-4 text-console-warn" />}
            />
            <MetricCard
              label="模型调用总次数"
              value={(summary?.total_calls || 0).toLocaleString("zh-CN")}
              hint="已成功完成全部编排"
              icon={<Layers aria-hidden="true" className="size-4 text-console-success" />}
            />
            <MetricCard
              label="平均调用响应耗时"
              value={(summary?.avg_latency_ms || 0).toString() + " ms"}
              hint="端到端 LiteLLM 延迟"
              icon={<Activity aria-hidden="true" className="size-4 text-console-ink-2" />}
            />
          </div>

          {/* 趋势图 + 排行 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* 堆叠柱图 */}
            <section
              aria-label="每日 Token 消耗趋势"
              className="console-card flex min-w-0 flex-col gap-4 p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <TrendingUp aria-hidden="true" className="size-4 text-console-accent" />
                  <div>
                    <h2 className="text-[13px] leading-[18px] font-semibold text-console-ink">
                      Token 消耗趋势
                    </h2>
                    <p className="console-meta">
                      输入 / 输出 Token 按天堆叠 · {rangeCaption}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="console-meta">当前周期 Token</p>
                  <p className="console-tabular text-[15px] leading-6 font-semibold text-console-ink">
                    {formatTokens(analytics.currentTotal)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1.5 console-meta">
                  <span aria-hidden="true" className="size-2 rounded-[2px] bg-chart-1" />
                  输入 Token
                </span>
                <span className="flex items-center gap-1.5 console-meta">
                  <span aria-hidden="true" className="size-2 rounded-[2px] bg-chart-5" />
                  输出 Token
                </span>
              </div>

              {isLoading ? (
                <SkeletonRows rows={6} />
              ) : !analytics.hasData ? (
                <EmptyState
                  title="暂无用量数据"
                  description="所选周期内没有模型调用记录，切换范围或刷新后重试。"
                  icon={<TrendingUp aria-hidden="true" className="size-5" />}
                />
              ) : (
                <div>
                  <div className="flex h-52 items-end gap-[3px]">
                    {analytics.chartBuckets.map((bucket) => {
                      const total = bucket.prompt + bucket.completion
                      const heightPercent =
                        total > 0 ? Math.max((total / analytics.maxTotal) * 100, 1.5) : 0
                      const promptShare =
                        total > 0 ? Math.max((bucket.prompt / total) * 100, 0) : 0
                      const completionShare =
                        total > 0 ? Math.max((bucket.completion / total) * 100, 0) : 0
                      const tooltipText =
                        bucket.date +
                        "\n输入 " +
                        formatTokens(bucket.prompt) +
                        " Token\n输出 " +
                        formatTokens(bucket.completion) +
                        " Token\n费用 " +
                        formatCost(bucket.cost) +
                        "\n调用 " +
                        bucket.calls +
                        " 次"
                      return (
                        <div
                          key={bucket.date}
                          className="group relative flex h-full min-w-0 flex-1 items-end"
                          title={tooltipText}
                        >
                          <div
                            className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-[220px] -translate-x-1/2 rounded-[8px] border border-console-line-2 bg-console-raised px-2.5 py-1.5 text-[11px] leading-4 text-console-ink shadow-lg group-hover:block"
                            role="tooltip"
                          >
                            <p className="font-medium">{bucket.date}</p>
                            <p className="console-tabular text-console-ink-2">
                              输入 {formatTokens(bucket.prompt)}
                            </p>
                            <p className="console-tabular text-console-ink-2">
                              输出 {formatTokens(bucket.completion)}
                            </p>
                            <p className="console-tabular text-console-ink-3">
                              {formatCost(bucket.cost)} · {bucket.calls} 次调用
                            </p>
                          </div>
                          <div
                            className="flex w-full flex-col-reverse overflow-hidden rounded-[3px] transition-[filter] duration-[var(--console-dur-list,190ms)] ease-[var(--console-ease-list,ease)] group-hover:brightness-110 motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
                            style={{ height: heightPercent + "%" }}
                          >
                            <div
                              className="w-full bg-chart-1"
                              style={{ height: promptShare + "%" }}
                            />
                            <div
                              className="w-full bg-chart-5"
                              style={{ height: completionShare + "%" }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-1.5 flex gap-[3px]">
                    {analytics.chartBuckets.map((bucket, index) => {
                      const step = Math.max(1, Math.ceil(analytics.chartBuckets.length / 6))
                      const showLabel =
                        index === 0 ||
                        index === analytics.chartBuckets.length - 1 ||
                        index % step === 0
                      return (
                        <span
                          key={bucket.date}
                          className="console-tabular min-w-0 flex-1 overflow-visible text-center text-xs leading-4 whitespace-nowrap text-console-ink-3"
                        >
                          {showLabel ? shortDate(bucket.date) : ""}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {analytics.capped ? (
                <p className="console-meta">
                  12m 受服务端查询上限限制，图表仅展示近 90 天；环比缺少历史窗口时显示「—」。
                </p>
              ) : null}
            </section>

            {/* 消耗排行 */}
            <section
              aria-label="消耗排行"
              className="console-card flex min-w-0 flex-col gap-4 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[13px] leading-[18px] font-semibold text-console-ink">
                    消耗排行
                  </h2>
                  <p className="console-meta">
                    {rankingMode === "models" ? "按模型累计费用 · Top 5" : "按任务累计费用 · Top 5"}
                  </p>
                </div>
                <SegmentedControl
                  ariaLabel="排行维度"
                  options={RANKING_OPTIONS}
                  value={rankingMode}
                  onChange={(next) => setRankingMode(next)}
                  size="sm"
                />
              </div>

              {isLoading ? (
                <SkeletonRows rows={5} />
              ) : rankingEmpty ? (
                <EmptyState
                  title="暂无排行数据"
                  description="所选工作区还没有产生模型调用费用。"
                  icon={<Flame aria-hidden="true" className="size-5" />}
                />
              ) : (
                <div className="divide-y divide-console-line">
                  {rankingItems.map((item) => {
                    const body = (
                      <>
                        <span
                          aria-hidden="true"
                          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-console-tag text-[13px] font-semibold text-console-ink-2"
                        >
                          {item.glyph}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] leading-[18px] text-console-ink">
                              {item.name}
                            </span>
                            <span className="console-tabular shrink-0 text-[13px] font-semibold text-console-ink">
                              {item.value}
                            </span>
                          </span>
                          <span className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="truncate text-xs leading-4 text-console-ink-3">
                              {item.subtitle}
                            </span>
                            <span className="console-meta shrink-0">
                              {item.percent.toFixed(1)}%
                            </span>
                          </span>
                          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-console-tag">
                            <span
                              className="block h-full rounded-full bg-console-accent"
                              style={{ width: item.percent + "%" }}
                            />
                          </span>
                        </span>
                      </>
                    )
                    return item.href ? (
                      <Link
                        key={item.key}
                        href={item.href}
                        className="-mx-2 flex items-start gap-3 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-console-hover"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div key={item.key} className="flex items-start gap-3 py-2.5">
                        {body}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          {/* 任务消耗明细 */}
          <section
            aria-label="任务消耗明细"
            className="console-card overflow-hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-console-line px-5 py-3">
              <div className="flex items-center gap-2">
                <Flame aria-hidden="true" className="size-4 text-console-warn" />
                <div>
                  <h2 className="text-[13px] leading-[18px] font-semibold text-console-ink">
                    任务消耗明细
                  </h2>
                  <p className="console-meta">按模型累计费用倒序 · 最多 10 条</p>
                </div>
              </div>
              <span className="console-meta">
                近 {windowDays} 天范围影响趋势图，明细为工作区累计
              </span>
            </div>

            {isLoading ? (
              <div className="p-4">
                <SkeletonRows rows={5} />
              </div>
            ) : topTasks.length === 0 ? (
              <EmptyState
                className="px-5 py-8"
                title="暂无任务调用明细"
                description="完成一次任务编排后，这里会列出费用最高的任务。"
                icon={<Flame aria-hidden="true" className="size-5" />}
              />
            ) : (
              <div className="console-scroll overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead>
                    <tr className="console-hairline-b text-[11px] text-console-ink-3">
                      <th className="px-5 py-2.5 font-medium">任务 ID</th>
                      <th className="px-3 py-2.5 font-medium">任务标题</th>
                      <th className="px-3 py-2.5 font-medium">状态</th>
                      <th className="px-3 py-2.5 font-medium">模型调用次数</th>
                      <th className="px-3 py-2.5 font-medium">总 Token</th>
                      <th className="px-5 py-2.5 text-right font-medium">总支出</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-console-line">
                    {topTasks.map((task) => (
                      <tr
                        key={task.task_id}
                        className="transition-colors hover:bg-console-hover/60"
                      >
                        <td className="px-5 py-2.5">
                          <Link
                            href={"/tasks/" + task.task_id}
                            className="inline-flex items-center gap-1 font-mono font-semibold text-console-accent hover:underline"
                          >
                            #{task.task_id}
                            <ExternalLink
                              aria-hidden="true"
                              className="size-3"
                            />
                          </Link>
                        </td>
                        <td className="max-w-xs truncate px-3 py-2.5 font-medium text-console-ink">
                          {task.task_title}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="console-pill px-2 py-0.5 text-[11px] text-console-ink-2">
                            {task.status}
                          </span>
                        </td>
                        <td className="console-tabular px-3 py-2.5 text-console-ink-2">
                          {task.model_call_count} 次
                        </td>
                        <td className="console-tabular px-3 py-2.5 text-console-ink">
                          {formatTokens(task.total_tokens)}
                        </td>
                        <td className="console-tabular px-5 py-2.5 text-right font-semibold text-console-ink">
                          {formatCost(task.cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Metric card                                                                */
/* -------------------------------------------------------------------------- */

function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string
  hint: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="console-card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs leading-4 text-console-ink-3">{label}</p>
        {icon}
      </div>
      <p className="console-tabular text-[1.35rem] leading-8 font-semibold tracking-[-0.01em] text-console-ink">
        {value}
      </p>
      <p className="text-[11px] leading-4 text-console-ink-3">{hint}</p>
    </div>
  )
}

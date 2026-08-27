"use client"

import { useState } from "react"
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bot,
  CalendarClock,
  Clock3,
  Coins,
  FileInput,
  ListChecks,
  Radio,
  RefreshCw,
  ServerCog,
  Timer,
  UserRound,
} from "lucide-react"
import Link from "next/link"

import { AppSidebar } from "@/components/console/app-sidebar"
import { ErrorBoundary } from "@/components/error-boundary"
import { TaskReplayPlayer } from "@/components/tasks/task-replay-player"
import { TaskStatusBadge } from "@/components/tasks/task-status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTaskDetail } from "@/hooks/use-tasks"
import {
  formatCost,
  formatDateTime,
  formatDuration,
  formatTokens,
  stepLabel,
} from "@/lib/task-format"
import { cn } from "@/lib/utils"
import type { ModelCall, TaskDetail, TaskStep, TaskTraceEvent } from "@/types/task"

const connectionLabels = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接断开",
}

interface TaskDetailPageProps {
  taskId: number
}

export function TaskDetailPage({ taskId }: TaskDetailPageProps) {
  const {
    task,
    connectionStatus,
    isLoading,
    error,
    retry,
  } = useTaskDetail(taskId)
  const [viewMode, setViewMode] = useState<"developer" | "user">("developer")
  const developer = viewMode === "developer"

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="tasks" />

      <ErrorBoundary>
        <main className="console-main px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
          <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-6">
            <header className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-3">
                <Link
                  href="/tasks"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 w-fit rounded-full text-muted-foreground hover:bg-secondary")}
                >
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  返回任务列表
                </Link>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-secondary/70 px-2.5 py-0.5 font-mono text-xs font-semibold text-primary">
                      TASK #{taskId}
                    </span>
                    {task ? <TaskStatusBadge status={task.status} /> : null}
                  </div>
                  <h1 className="mt-1.5 max-w-[42ch] text-balance break-words text-[1.85rem] font-bold tracking-[-0.03em] text-foreground">
                    {task?.title ?? "任务详情"}
                  </h1>
                </div>
              </div>
              <div className="mt-9 flex flex-col items-end gap-2.5">
                <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
                <Badge
                  className="connection-chip"
                  variant={connectionStatus === "offline" ? "destructive" : "outline"}
                >
                  <span
                    className="status-dot size-1.5 rounded-full"
                    data-status={connectionStatus}
                    aria-hidden="true"
                  />
                  {connectionLabels[connectionStatus]}
                </Badge>
              </div>
            </header>

            {isLoading ? (
              <TaskDetailSkeleton />
            ) : !task ? (
              <TaskDetailError error={error ?? "任务不存在。"} onRetry={retry} />
            ) : (
              <>
                {error ? <RealtimeError error={error} onRetry={retry} /> : null}
                <TaskOverview task={task} />
                <TaskMetrics task={task} developer={developer} />
                <TaskReplayPlayer taskId={task.id} onTaskResumed={retry} />
                <ExecutionTracePanel task={task} developer={developer} />
                <OriginalInput task={task} />
                <TaskSteps steps={task.task_steps} developer={developer} />
                {developer ? <ModelCallLogs calls={task.model_calls} /> : null}
              </>
            )}
          </div>
        </main>
      </ErrorBoundary>
    </div>
  )
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: "developer" | "user"
  onChange: (mode: "developer" | "user") => void
}) {
  const options = [
    { value: "developer", label: "开发者视图" },
    { value: "user", label: "用户视图" },
  ] as const
  return (
    <div
      role="tablist"
      aria-label="任务详情视图切换"
      className="flex rounded-full border border-border/70 bg-secondary/40 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={viewMode === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            viewMode === option.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function TaskOverview({ task }: { task: TaskDetail }) {
  return (
    <section className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)] lg:p-7">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              任务描述
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {task.description || "暂无任务描述"}
            </p>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              任务结果
            </p>
            <div
              className={cn(
                "rounded-2xl border px-4.5 py-3.5 text-sm leading-relaxed shadow-inner",
                task.status === "failed"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border/70 bg-secondary/40 text-foreground",
              )}
            >
              <p className="max-h-52 overflow-y-auto whitespace-pre-wrap scrollbar-thin">
                {task.result ?? "等待 Agent 输出任务结果。"}
              </p>
            </div>
          </div>
        </div>

        <dl className="grid content-start gap-4 rounded-2xl border border-border/70 bg-secondary/30 p-5 sm:grid-cols-2 lg:grid-cols-1">
          <OverviewItem icon={UserRound} label="负责 Agent">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size="sm" className="rounded-full ring-1 ring-border">
                <AvatarFallback className="rounded-full bg-secondary text-foreground text-xs font-semibold">
                  {task.assigned_agent?.avatar ??
                    task.assigned_agent?.name.slice(0, 1) ??
                    "—"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {task.assigned_agent?.name ?? "未分配"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {task.assigned_agent?.role ?? "—"}
                </p>
              </div>
            </div>
          </OverviewItem>
          <OverviewItem icon={CalendarClock} label="创建时间">
            <p className="font-mono text-xs text-foreground/90">{formatDateTime(task.created_at)}</p>
          </OverviewItem>
          <OverviewItem icon={RefreshCw} label="更新时间">
            <p className="font-mono text-xs text-foreground/90">{formatDateTime(task.updated_at)}</p>
          </OverviewItem>
        </dl>
      </div>
    </section>
  )
}

function OverviewItem({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserRound
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0">
        <dt className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  )
}

function TaskMetrics({ task, developer }: { task: TaskDetail; developer: boolean }) {
  const metrics = [
    { label: "执行步骤", value: formatTokens(task.task_steps.length), icon: ListChecks },
    { label: "模型调用", value: formatTokens(task.model_calls.length), icon: ServerCog },
    ...(developer
      ? [{ label: "Token 使用", value: formatTokens(task.token_usage.total_tokens), icon: Coins }]
      : []),
    { label: "总耗时", value: formatDuration(task.duration_ms), icon: Timer },
  ]

  return (
    <section aria-label="任务执行指标" className="console-panel grid grid-cols-2 overflow-hidden rounded-3xl border border-border/70 bg-card/85 shadow-sm lg:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <div key={metric.label} className="flex items-center gap-3.5 border-r border-b border-border/60 p-5 lg:border-b-0 last:border-r-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-sm">
              <Icon aria-hidden="true" className="size-4.5" />
            </span>
            <div className="min-w-0">
              <span className="block text-xs font-medium text-muted-foreground">{metric.label}</span>
              <p className="mt-0.5 truncate font-mono text-base font-bold text-foreground sm:text-lg">
                {metric.value}
              </p>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function ExecutionTracePanel({ task, developer }: { task: TaskDetail; developer: boolean }) {
  const trace = task.execution_trace
  return (
    <section className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <SectionHeader
        icon={Activity}
        title="执行轨迹"
        description={task.trace_summary ?? "结构化上下文、模型调用链和阶段摘要"}
      />
      <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0 space-y-3">
          <TraceSummaryCard
            traceSummary={task.trace_summary}
            contextSnapshot={task.context_snapshot}
            developer={developer}
          />
        </div>
        <div className="min-w-0">
          <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <p className="mb-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">轨迹事件</p>
            <div className="max-h-[26rem] space-y-2.5 overflow-auto pr-1 scrollbar-thin">
              {trace.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">当前任务尚未产生轨迹事件。</p>
              ) : (
                trace.map((item) => <TraceEventRow key={`${item.source_type ?? 'trace'}-${item.source_id ?? item.created_at}-${item.title}`} event={item} developer={developer} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function TraceSummaryCard({
  traceSummary,
  contextSnapshot,
  developer,
}: {
  traceSummary: string | null
  contextSnapshot: string | null
  developer: boolean
}) {
  return (
    <div className="space-y-3.5">
      <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4.5">
        <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">轨迹摘要</p>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground scrollbar-thin">{traceSummary ?? "暂无轨迹摘要。"}</pre>
      </div>
      {developer ? (
        <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4.5">
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">模型上下文快照</p>
          <pre className="max-h-[22rem] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground scrollbar-thin">{contextSnapshot ?? "暂无上下文快照。"}</pre>
        </div>
      ) : null}
    </div>
  )
}

function TraceEventRow({ event, developer }: { event: TaskTraceEvent; developer: boolean }) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card/90 p-3.5 shadow-sm transition-all hover:border-primary/30">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{event.title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{event.stage} · {event.actor ?? "系统"} · {event.type}</p>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">{event.status ?? "trace"}</Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-foreground/90">{event.summary}</p>
      {developer && event.detail ? <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-border/60 bg-secondary/40 p-2.5 font-mono text-[11px] leading-relaxed scrollbar-thin">{event.detail}</pre> : null}
    </article>
  )
}

function OriginalInput({ task }: { task: TaskDetail }) {
  return (
    <section className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <SectionHeader
        icon={FileInput}
        title="原始输入"
        description={task.input_message_id ? `消息 #${task.input_message_id}` : "未关联输入消息"}
      />
      <div className="p-5 sm:p-6">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-border/70 bg-secondary/35 p-4.5 font-sans text-sm leading-relaxed text-foreground scrollbar-thin">
          {task.original_input ?? "暂无原始输入。"}
        </pre>
      </div>
    </section>
  )
}

function TaskSteps({ steps, developer }: { steps: TaskStep[]; developer: boolean }) {
  return (
    <section className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <SectionHeader
        icon={ListChecks}
        title="Task Steps Pipeline"
        description={`${steps.length} 个执行步骤 · 链路顺序追踪`}
      />
      {steps.length === 0 ? (
        <EmptySection icon={ListChecks} text="任务开始执行后，步骤流程图会实时推送到这里。" />
      ) : (
        <div className="p-5 sm:p-6 space-y-6">
          {steps.map((step, index) => (
            <article key={step.id} className="relative flex gap-4 lg:gap-6">
              {/* Stepper Guide Line & Node Badge */}
              <div className="flex flex-col items-center shrink-0">
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border font-mono text-xs font-bold shadow-sm transition-all",
                    step.status === "failed"
                      ? "border-destructive/60 bg-destructive/15 text-destructive shadow-[0_0_10px_var(--destructive)]"
                      : step.status === "completed"
                        ? "border-primary/50 bg-primary/20 text-primary shadow-[0_0_10px_color-mix(in_oklch,var(--primary)_25%,transparent)]"
                        : step.status === "running"
                          ? "border-[var(--status-running)] bg-[var(--status-running)]/20 text-foreground animate-pulse"
                          : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                {index < steps.length - 1 ? (
                  <span className="my-1.5 h-full w-0.5 min-h-12 bg-border/60 rounded-full" />
                ) : null}
              </div>

              {/* Step Main Card */}
              <div className="min-w-0 flex-1 rounded-2xl border border-border/70 bg-secondary/30 p-4.5 shadow-sm transition-all hover:border-primary/30">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">{stepLabel(step.step_name)}</h3>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <Bot aria-hidden="true" className="size-3.5 text-primary" />
                        {step.agent?.name ?? "未记录 Agent"}
                      </span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock3 aria-hidden="true" className="size-3 text-muted-foreground" />
                        {formatDuration(step.duration_ms)}
                      </span>
                      <span className="font-mono">{formatDateTime(step.started_at)}</span>
                    </div>
                  </div>
                  <TaskStatusBadge status={step.status} />
                </div>

                {developer ? (
                  <div className="mt-3.5 grid gap-3 xl:grid-cols-2">
                    <StepPayload label="步骤输入" value={step.input} />
                    <StepPayload
                      label={step.status === "failed" ? "错误输出" : "步骤输出"}
                      value={step.output}
                      isError={step.status === "failed"}
                    />
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function StepPayload({ label, value, isError = false }: { label: string; value: string | null; isError?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <pre
        className={cn(
          "max-h-64 min-h-24 overflow-auto whitespace-pre-wrap rounded-2xl border p-3.5 font-mono text-[11px] leading-relaxed scrollbar-thin shadow-inner",
          isError
            ? "border-destructive/35 bg-destructive/10 text-destructive"
            : "border-border/60 bg-card/80 text-foreground",
        )}
      >
        {value ?? "暂无内容"}
      </pre>
    </div>
  )
}

function ModelCallLogs({ calls }: { calls: ModelCall[] }) {
  return (
    <section className="console-panel overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <SectionHeader
        icon={Activity}
        title="模型调用 Trace 日志"
        description={`${calls.length} 次调用 · Token 消耗、延迟与成本指标`}
      />
      {calls.length === 0 ? (
        <EmptySection icon={ServerCog} text="模型调用完成后，Trace 日志会实时出现在这里。" />
      ) : (
        <div className="divide-y divide-border/60">
          {calls.map((call, index) => (
            <ModelCallRow key={call.id} call={call} index={index} />
          ))}
        </div>
      )}
    </section>
  )
}

function ModelCallRow({ call, index }: { call: ModelCall; index: number }) {
  return (
    <article className="p-5 hover:bg-secondary/30 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-secondary font-mono text-xs font-bold text-primary">
            #{index + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-mono text-sm font-semibold text-foreground">{call.model_name}</h3>
              <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 text-primary text-[10px]">{call.provider}</Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5 text-foreground">
                <Bot aria-hidden="true" className="size-3.5 text-primary" />
                {call.agent?.name ?? "未记录 Agent"}
              </span>
              <span className="font-mono text-muted-foreground">CALL #{call.id}</span>
              <span className="font-mono">{formatDateTime(call.created_at)}</span>
            </p>
          </div>
        </div>
        <TaskStatusBadge status={call.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 sm:grid-cols-3 xl:grid-cols-6 shadow-sm">
        <CallMetric label="Prompt Token" value={formatTokens(call.prompt_tokens)} />
        <CallMetric label="Completion Token" value={formatTokens(call.completion_tokens)} />
        <CallMetric label="Total Token" value={formatTokens(call.total_tokens)} />
        <CallMetric label="耗时 (ms)" value={formatDuration(call.latency_ms)} highlight={Boolean(call.latency_ms && call.latency_ms > 5000)} />
        <CallMetric label="预估成本 ($)" value={formatCost(call.cost)} />
        <CallMetric label="执行状态" value={call.status} />
      </dl>

      {call.error_message ? (
        <div className="mt-3.5 flex gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs leading-relaxed text-destructive shadow-sm">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">错误信息</p>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px]">{call.error_message}</pre>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function CallMetric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-card/95 px-3.5 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 truncate font-mono text-xs font-semibold", highlight ? "text-amber-400" : "text-foreground")}>
        {value}
      </dd>
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileInput
  title: string
  description: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 sm:px-6 bg-card/40">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold sm:text-base text-foreground">{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{description}</p>
        </div>
      </div>
      <Radio aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
    </div>
  )
}

function EmptySection({ icon: Icon, text }: { icon: typeof ListChecks; text: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}

function RealtimeError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-sm">
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate">{error}</p>
      <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}

function TaskDetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border/70 bg-card/85 p-6">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="mt-3 h-5 w-full max-w-2xl rounded-full" />
        <Skeleton className="mt-2 h-5 w-full max-w-xl rounded-full" />
        <Skeleton className="mt-6 h-28 w-full rounded-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-3xl" />
      <Skeleton className="h-80 rounded-3xl" />
    </div>
  )
}

function TaskDetailError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <section className="flex min-h-[55vh] items-center justify-center rounded-3xl border border-destructive/35 bg-card/85 p-6 shadow-sm">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertCircle aria-hidden="true" className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-foreground">无法打开任务详情</h2>
          <p className="text-sm leading-6 text-muted-foreground">{error}</p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/tasks" className={cn(buttonVariants({ variant: "outline" }), "rounded-full")}>
            返回列表
          </Link>
          <Button type="button" className="rounded-full" onClick={onRetry}>重新加载</Button>
        </div>
      </div>
    </section>
  )
}

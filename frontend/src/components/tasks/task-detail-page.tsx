"use client"

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
import type { ModelCall, TaskDetail, TaskStep } from "@/types/task"

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
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 w-fit text-muted-foreground")}
                >
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  返回任务列表
                </Link>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      TASK #{taskId}
                    </span>
                    {task ? <TaskStatusBadge status={task.status} /> : null}
                  </div>
                  <h1 className="mt-1 max-w-[42ch] text-balance break-words text-[1.75rem] font-semibold tracking-[-0.025em]">
                    {task?.title ?? "任务详情"}
                  </h1>
                </div>
              </div>
              <Badge
                className="connection-chip mt-9"
                variant={connectionStatus === "offline" ? "destructive" : "outline"}
              >
                <span
                  className="status-dot size-1.5 rounded-full"
                  data-status={connectionStatus}
                  aria-hidden="true"
                />
                {connectionLabels[connectionStatus]}
              </Badge>
            </header>

            {isLoading ? (
              <TaskDetailSkeleton />
            ) : !task ? (
              <TaskDetailError error={error ?? "任务不存在。"} onRetry={retry} />
            ) : (
              <>
                {error ? <RealtimeError error={error} onRetry={retry} /> : null}
                <TaskOverview task={task} />
                <TaskMetrics task={task} />
                <OriginalInput task={task} />
                <TaskSteps steps={task.task_steps} />
                <ModelCallLogs calls={task.model_calls} />
              </>
            )}
          </div>
        </main>
      </ErrorBoundary>
    </div>
  )
}

function TaskOverview({ task }: { task: TaskDetail }) {
  return (
    <section className="console-panel overflow-hidden rounded-xl border border-border bg-card/72">
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.8fr)] lg:p-6">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              任务描述
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
              {task.description || "暂无任务描述"}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              任务结果
            </p>
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-sm leading-6",
                task.status === "failed"
                  ? "border-destructive/30 bg-destructive/8 text-destructive"
                  : "border-border bg-background/45 text-foreground/90",
              )}
            >
              <p className="max-h-52 overflow-y-auto whitespace-pre-wrap scrollbar-thin">
                {task.result ?? "等待 Agent 输出任务结果。"}
              </p>
            </div>
          </div>
        </div>

        <dl className="grid content-start gap-4 rounded-lg border border-border bg-background/35 p-4 sm:grid-cols-2 lg:grid-cols-1">
          <OverviewItem icon={UserRound} label="负责 Agent">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size="sm">
                <AvatarFallback>
                  {task.assigned_agent?.avatar ??
                    task.assigned_agent?.name.slice(0, 1) ??
                    "—"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">
                  {task.assigned_agent?.name ?? "未分配"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {task.assigned_agent?.role ?? "—"}
                </p>
              </div>
            </div>
          </OverviewItem>
          <OverviewItem icon={CalendarClock} label="创建时间">
            <p className="font-mono text-xs">{formatDateTime(task.created_at)}</p>
          </OverviewItem>
          <OverviewItem icon={RefreshCw} label="更新时间">
            <p className="font-mono text-xs">{formatDateTime(task.updated_at)}</p>
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
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0">
        <dt className="mb-1 text-[11px] text-muted-foreground">{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  )
}

function TaskMetrics({ task }: { task: TaskDetail }) {
  const metrics = [
    { label: "执行步骤", value: formatTokens(task.task_steps.length), icon: ListChecks },
    { label: "模型调用", value: formatTokens(task.model_calls.length), icon: ServerCog },
    { label: "Token 使用", value: formatTokens(task.token_usage.total_tokens), icon: Coins },
    { label: "总耗时", value: formatDuration(task.duration_ms), icon: Timer },
  ]

  return (
    <section aria-label="任务执行指标" className="console-panel grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card/65 lg:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = metric.icon
        return (
          <div key={metric.label} className="flex items-center gap-3 border-r border-b border-border/75 p-4 lg:border-b-0">
            <span className="section-mark flex size-9 shrink-0 items-center justify-center rounded-md">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <span className="block text-xs text-muted-foreground">{metric.label}</span>
              <p className="mt-0.5 truncate font-mono text-base font-semibold sm:text-lg">
                {metric.value}
              </p>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function OriginalInput({ task }: { task: TaskDetail }) {
  return (
    <section className="console-panel overflow-hidden rounded-xl border border-border bg-card/72">
      <SectionHeader
        icon={FileInput}
        title="原始输入"
        description={task.input_message_id ? `消息 #${task.input_message_id}` : "未关联输入消息"}
      />
      <div className="p-4 sm:p-5">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/55 p-4 font-sans text-sm leading-6 text-foreground/90 scrollbar-thin">
          {task.original_input ?? "暂无原始输入。"}
        </pre>
      </div>
    </section>
  )
}

function TaskSteps({ steps }: { steps: TaskStep[] }) {
  return (
    <section className="console-panel overflow-hidden rounded-xl border border-border bg-card/80 shadow-md">
      <SectionHeader
        icon={ListChecks}
        title="Task Steps Pipeline"
        description={`${steps.length} 个执行步骤 · 链路顺序追踪`}
      />
      {steps.length === 0 ? (
        <EmptySection icon={ListChecks} text="任务开始执行后，步骤流程图会实时推送到这里。" />
      ) : (
        <div className="p-4 sm:p-6 space-y-6">
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
                        ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_10px_color-mix(in_oklch,var(--primary)_25%,transparent)]"
                        : step.status === "running"
                          ? "border-[var(--status-running)] bg-[var(--status-running)]/20 text-foreground animate-pulse"
                          : "border-border bg-muted/60 text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                {index < steps.length - 1 ? (
                  <span className="my-1.5 h-full w-0.5 min-h-12 bg-border/70 rounded-full" />
                ) : null}
              </div>

              {/* Step Main Card */}
              <div className="min-w-0 flex-1 rounded-xl border border-border/80 bg-background/50 p-4 shadow-sm transition-colors hover:border-primary/30">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{stepLabel(step.step_name)}</h3>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-medium text-foreground/80">
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

                <div className="mt-3.5 grid gap-3 xl:grid-cols-2">
                  <StepPayload label="步骤输入" value={step.input} />
                  <StepPayload
                    label={step.status === "failed" ? "错误输出" : "步骤输出"}
                    value={step.output}
                    isError={step.status === "failed"}
                  />
                </div>
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
      <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{label}</p>
      <pre
        className={cn(
          "max-h-64 min-h-24 overflow-auto whitespace-pre-wrap rounded-xl border p-3.5 font-mono text-[11px] leading-5 scrollbar-thin shadow-inner",
          isError
            ? "border-destructive/35 bg-destructive/10 text-destructive"
            : "border-border/70 bg-card/70 text-foreground/90",
        )}
      >
        {value ?? "暂无内容"}
      </pre>
    </div>
  )
}

function ModelCallLogs({ calls }: { calls: ModelCall[] }) {
  return (
    <section className="console-panel overflow-hidden rounded-xl border border-border bg-card/80 shadow-md">
      <SectionHeader
        icon={Activity}
        title="模型调用 Trace 日志"
        description={`${calls.length} 次调用 · Token 消耗、延迟与成本指标`}
      />
      {calls.length === 0 ? (
        <EmptySection icon={ServerCog} text="模型调用完成后，Trace 日志会实时出现在这里。" />
      ) : (
        <div className="divide-y divide-border/70">
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
    <article className="p-4 sm:p-5 hover:bg-muted/15 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary/80 font-mono text-xs font-bold text-foreground">
            #{index + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-mono text-sm font-semibold">{call.model_name}</h3>
              <Badge variant="outline" className="border-primary/30 text-primary">{call.provider}</Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Bot aria-hidden="true" className="size-3 text-primary" />
                {call.agent?.name ?? "未记录 Agent"}
              </span>
              <span className="font-mono text-foreground/70">CALL #{call.id}</span>
              <span className="font-mono">{formatDateTime(call.created_at)}</span>
            </p>
          </div>
        </div>
        <TaskStatusBadge status={call.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/80 bg-border/80 sm:grid-cols-3 xl:grid-cols-6 shadow-sm">
        <CallMetric label="Prompt Token" value={formatTokens(call.prompt_tokens)} />
        <CallMetric label="Completion Token" value={formatTokens(call.completion_tokens)} />
        <CallMetric label="Total Token" value={formatTokens(call.total_tokens)} />
        <CallMetric label="耗时 (ms)" value={formatDuration(call.latency_ms)} highlight={Boolean(call.latency_ms && call.latency_ms > 5000)} />
        <CallMetric label="预估成本 ($)" value={formatCost(call.cost)} />
        <CallMetric label="执行状态" value={call.status} />
      </dl>

      {call.error_message ? (
        <div className="mt-3 flex gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
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
    <div className="bg-card/90 px-3 py-2.5">
      <dt className="text-[10px] font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 truncate font-mono text-xs font-semibold", highlight ? "text-orange-400" : "text-foreground")}>
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
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="section-mark flex size-9 shrink-0 items-center justify-center rounded-md">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
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
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}

function RealtimeError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1 truncate">{error}</p>
      <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}

function TaskDetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/72 p-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-5 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-5 w-full max-w-xl" />
        <Skeleton className="mt-6 h-28 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}

function TaskDetailError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <section className="flex min-h-[55vh] items-center justify-center rounded-xl border border-destructive/35 bg-card/80 p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle aria-hidden="true" className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">无法打开任务详情</h2>
          <p className="text-sm leading-6 text-muted-foreground">{error}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/tasks" className={buttonVariants({ variant: "outline" })}>
            返回列表
          </Link>
          <Button type="button" onClick={onRetry}>重新加载</Button>
        </div>
      </div>
    </section>
  )
}

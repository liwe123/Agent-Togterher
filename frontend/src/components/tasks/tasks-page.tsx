"use client"

import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  ListTodo,
  LoaderCircle,
  Radio,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { AppSidebar } from "@/components/console/app-sidebar"
import { TaskStatusBadge } from "@/components/tasks/task-status-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useTasks } from "@/hooks/use-tasks"
import { formatDateTime } from "@/lib/task-format"
import { cn } from "@/lib/utils"
import type { TaskListItem } from "@/types/task"

const connectionLabels = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接断开",
}

const filters = [
  { value: "all", label: "全部", icon: ListTodo },
  { value: "pending", label: "等待处理", icon: CircleDashed },
  { value: "running", label: "进行中", icon: LoaderCircle },
  { value: "completed", label: "已完成", icon: CheckCircle2 },
  { value: "failed", label: "失败", icon: XCircle },
] as const

type TaskFilter = (typeof filters)[number]["value"]

export function TasksPage() {
  const {
    workspace,
    tasks,
    connectionStatus,
    isLoading,
    error,
    retry,
  } = useTasks()
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("all")
  const counts = tasks.reduce<Record<TaskFilter, number>>(
    (result, task) => {
      result.all += 1
      if (task.status in result) result[task.status as TaskFilter] += 1
      return result
    },
    { all: 0, pending: 0, running: 0, completed: 0, failed: 0 },
  )
  const filteredTasks =
    activeFilter === "all"
      ? tasks
      : tasks.filter((task) => task.status === activeFilter)

  return (
    <div className="console-shell grid grid-cols-[minmax(0,1fr)] overflow-x-hidden md:grid-cols-[232px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="tasks" />

      <main className="console-main px-4 py-5 sm:px-6 md:px-8 md:py-8 xl:px-10">
        <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-7">
          <header className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em]">任务队列</h1>
              <p className="truncate text-xs text-muted-foreground sm:text-sm">
                {workspace
                  ? `${workspace.name} · 任务执行与结果总览`
                  : "任务执行与结果总览"}
              </p>
            </div>
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
          </header>

          <section aria-label="任务状态筛选" className="console-panel grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-card/70 p-1.5 sm:grid-cols-5">
            {filters.map((filter) => {
              const Icon = filter.icon
              const isActive = activeFilter === filter.value
              return (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActiveFilter(filter.value)}
                  className={cn(
                    "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? "border-primary/45 bg-primary/9 text-foreground"
                      : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-muted/45 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md",
                      isActive ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px]">
                      {filter.label}
                    </span>
                    <span className="font-mono text-base font-semibold leading-5 text-foreground">
                      {counts[filter.value]}
                    </span>
                  </span>
                </button>
              )
            })}
          </section>

          {error && tasks.length > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
              <p className="min-w-0 flex-1 truncate">{error}</p>
              <Button type="button" size="sm" variant="ghost" onClick={retry}>
                重试
              </Button>
            </div>
          ) : null}

          <section className="console-panel overflow-hidden rounded-xl border border-border bg-card/72">
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="section-mark flex size-9 shrink-0 items-center justify-center rounded-md">
                  <ListTodo aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold sm:text-base">任务列表</h2>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
                    <Radio aria-hidden="true" className="size-3" />
                    WebSocket 状态实时同步
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {filteredTasks.length} 条
              </span>
            </div>

            {isLoading ? (
              <TaskListSkeleton />
            ) : error && tasks.length === 0 ? (
              <TaskListError error={error} onRetry={retry} />
            ) : filteredTasks.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <ListTodo aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h3 className="text-sm font-medium">暂无匹配任务</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    新任务会从群聊创建并实时出现在这里。
                  </p>
                </div>
              </div>
            ) : (
              <TaskList tasks={filteredTasks} />
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

function TaskList({ tasks }: { tasks: TaskListItem[] }) {
  return (
    <div>
      <div className="hidden grid-cols-[minmax(260px,1.8fr)_minmax(140px,0.9fr)_120px_150px_150px_minmax(170px,1.1fr)_24px] gap-4 border-b border-border bg-muted/25 px-5 py-2.5 text-[11px] font-medium text-muted-foreground lg:grid">
        <span>任务</span>
        <span>负责 Agent</span>
        <span>状态</span>
        <span>创建时间</span>
        <span>更新时间</span>
        <span>任务结果</span>
        <span className="sr-only">查看</span>
      </div>
      <div className="divide-y divide-border">
        {tasks.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="group grid gap-4 px-4 py-4 transition-colors hover:bg-muted/28 focus-visible:bg-muted/28 sm:grid-cols-[minmax(0,1.5fr)_minmax(160px,0.7fr)] sm:px-5 lg:grid-cols-[minmax(260px,1.8fr)_minmax(140px,0.9fr)_120px_150px_150px_minmax(170px,1.1fr)_24px] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  #{task.id}
                </span>
                <h3 className="truncate text-sm font-semibold">{task.title}</h3>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground lg:line-clamp-1">
                {task.description || "暂无任务描述"}
              </p>
            </div>

            <div className="flex min-w-0 items-center gap-2">
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

            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center lg:contents">
              <TaskStatusBadge status={task.status} />
              <TaskTime label="创建" value={task.created_at} />
              <TaskTime label="更新" value={task.updated_at} />
            </div>

            <div className="min-w-0 sm:col-span-2 lg:col-span-1">
              <span className="mb-1 block text-[11px] text-muted-foreground lg:hidden">
                任务结果
              </span>
              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                {task.result ?? "等待 Agent 输出"}
              </p>
            </div>

            <ArrowUpRight
              aria-hidden="true"
              className="hidden size-4 text-muted-foreground transition group-hover:text-primary lg:block"
            />
          </Link>
        ))}
      </div>
    </div>
  )
}

function TaskTime({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 font-mono text-[11px] leading-5 text-muted-foreground">
      <span className="mr-2 text-foreground/70 lg:hidden">{label}</span>
      {formatDateTime(value)}
    </div>
  )
}

function TaskListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="grid gap-4 px-5 py-5 lg:grid-cols-4">
          <div className="space-y-2 lg:col-span-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full max-w-md" />
          </div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  )
}

function TaskListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertCircle aria-hidden="true" className="size-5" />
      </span>
      <div className="max-w-md">
        <h3 className="text-sm font-semibold">无法加载任务</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        重新连接
      </Button>
    </div>
  )
}

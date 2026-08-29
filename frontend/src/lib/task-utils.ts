const terminalTaskStatuses = new Set(["completed", "failed", "cancelled"])

function taskTimestamp(task: { updated_at: string }): number {
  const timestamp = Date.parse(task.updated_at)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function taskStatusRank(status: string): number {
  if (terminalTaskStatuses.has(status)) return 2
  return status === "running" || status === "waiting_approval" ? 1 : 0
}

function shouldApplyTaskStatus<
  T extends { status: string; updated_at: string },
>(current: T, next: T): boolean {
  const currentTime = taskTimestamp(current)
  const nextTime = taskTimestamp(next)
  if (nextTime !== currentTime) return nextTime > currentTime
  return taskStatusRank(next.status) >= taskStatusRank(current.status)
}

function applySnapshotTasks<
  T extends { id: number; status: string; updated_at: string },
>(current: T[], snapshotTasks: Partial<T>[]): T[] {
  let changed = false
  const merged = current.map((task) => {
    const incoming = snapshotTasks.find((item) => item.id === task.id)
    if (!incoming) return task
    const candidate = { ...task, ...incoming } as T
    if (!shouldApplyTaskStatus(task, candidate)) return task
    changed = true
    return candidate
  })
  return changed ? merged : current
}

interface TraceEventLike {
  source_type: string | null
  source_id: number | null
}

function traceEventKey(event: TraceEventLike): string {
  return `${event.source_type ?? "trace"}-${event.source_id ?? "none"}`
}

function mergeTraceEvent<T extends TraceEventLike>(current: T[], incoming: T): T[] {
  const key = traceEventKey(incoming)
  const index = current.findIndex((event) => traceEventKey(event) === key)
  if (index === -1) return [...current, incoming]
  return current.map((event, i) => (i === index ? incoming : event))
}

export {
  applySnapshotTasks,
  mergeTraceEvent,
  shouldApplyTaskStatus,
  taskStatusRank,
  taskTimestamp,
  terminalTaskStatuses,
  traceEventKey,
}

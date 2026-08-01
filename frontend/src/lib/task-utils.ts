const terminalTaskStatuses = new Set(["completed", "failed", "cancelled"])

function taskTimestamp(task: { updated_at: string }): number {
  const timestamp = Date.parse(task.updated_at)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function taskStatusRank(status: string): number {
  if (terminalTaskStatuses.has(status)) return 2
  return status === "running" ? 1 : 0
}

function shouldApplyTaskStatus<
  T extends { status: string; updated_at: string },
>(current: T, next: T): boolean {
  const currentTime = taskTimestamp(current)
  const nextTime = taskTimestamp(next)
  if (nextTime !== currentTime) return nextTime > currentTime
  return taskStatusRank(next.status) >= taskStatusRank(current.status)
}

export { shouldApplyTaskStatus, taskStatusRank, taskTimestamp, terminalTaskStatuses }

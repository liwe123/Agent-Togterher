import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusLabels: Record<string, string> = {
  pending: "等待处理",
  running: "进行中",
  waiting_approval: "等待审批",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
}

const statusClasses: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  running: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  waiting_approval: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  failed: "border-destructive/30 bg-destructive/15 text-destructive",
  cancelled: "border-border bg-secondary text-muted-foreground",
}

interface TaskStatusBadgeProps {
  status: string
  className?: string
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full px-2.5 py-0.5 font-medium shadow-sm", statusClasses[status] ?? statusClasses.cancelled, className)}
    >
      <span
        className="status-dot size-1.5 rounded-full"
        data-status={status === "completed" ? "online" : status}
        aria-hidden="true"
      />
      {statusLabels[status] ?? status}
    </Badge>
  )
}

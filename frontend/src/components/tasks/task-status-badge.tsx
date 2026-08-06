import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const statusLabels: Record<string, string> = {
  pending: "等待处理",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
}

const statusClasses: Record<string, string> = {
  pending: "border-primary/30 bg-primary/10 text-primary",
  running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 md:text-emerald-300",
  completed: "border-emerald-500/22 bg-emerald-500/7 text-emerald-700 md:text-emerald-300",
  failed: "border-destructive/30 bg-destructive/12 text-destructive",
  cancelled: "border-border bg-muted text-muted-foreground",
}

interface TaskStatusBadgeProps {
  status: string
  className?: string
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(statusClasses[status] ?? statusClasses.cancelled, className)}
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

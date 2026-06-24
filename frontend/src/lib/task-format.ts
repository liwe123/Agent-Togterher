const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

const numberFormatter = new Intl.NumberFormat("zh-CN")

export function formatDateTime(value: string | null) {
  if (value === null) return "—"
  return dateTimeFormatter.format(new Date(value))
}

export function formatDuration(value: number | null) {
  if (value === null) return "进行中"
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1000)
  return `${minutes} 分 ${seconds} 秒`
}

export function formatTokens(value: number) {
  return numberFormatter.format(value)
}

export function formatCost(value: string) {
  const cost = Number(value)
  if (!Number.isFinite(cost) || cost === 0) return "$0.000000"
  return `$${cost.toFixed(6)}`
}

export function stepLabel(stepName: string) {
  if (stepName === "manager_plan") return "Manager 任务拆解"
  if (stepName === "review_results") return "测试专员审核"
  if (stepName === "final_summary") return "Manager 最终汇总"
  if (stepName === "call_agent_model") return "Agent 模型执行"
  if (stepName.startsWith("worker_execute_")) {
    return `Worker 执行 ${stepName.replace("worker_execute_", "")}`
  }
  return stepName
}

import type { Agent } from "@/types/agent"

/** Agent 角色中文名（团队列 / 详情面板 / 命令面板共用） */
export const AGENT_ROLE_LABELS: Record<string, string> = {
  project_architect: "项目总设计师",
  agent_engineer: "Agent 工程师",
  frontend_designer: "前端设计师",
  knowledge_manager: "知识库管理员",
  qa_engineer: "测试专员",
  operations_engineer: "运维工程师",
}

export function agentRoleLabel(role: string): string {
  return AGENT_ROLE_LABELS[role] ?? (role || "成员")
}

export type AgentStatusTone = "running" | "warning" | "danger" | "idle"

/** 状态语法：running 成功色 / 待审批 警示色 / failed 危险色 / 其余三级文字色 */
export function agentStatusTone(status: string): AgentStatusTone {
  if (status === "running") return "running"
  if (status === "failed") return "danger"
  if (
    status === "pending" ||
    status === "waiting" ||
    status === "approval" ||
    status === "waiting_approval"
  ) {
    return "warning"
  }
  return "idle"
}

export function agentStatusDotClass(status: string): string {
  switch (agentStatusTone(status)) {
    case "running":
      return "bg-console-success"
    case "warning":
      return "bg-console-warn"
    case "danger":
      return "bg-console-danger"
    default:
      return "bg-console-ink-3"
  }
}

export function agentStatusLabel(status: string): string {
  switch (agentStatusTone(status)) {
    case "running":
      return "工作中"
    case "warning":
      return "待审批"
    case "danger":
      return "需要处理"
    default:
      return "空闲"
  }
}

/** 团队列单行预览：正在做的事 → 等待审批 → 需要处理 → 绑定模型 */
export function agentPreview(agent: Agent): string {
  const tone = agentStatusTone(agent.status)
  if (tone === "running") {
    return agent.model_name ? `正在处理任务 · ${agent.model_name}` : "正在处理任务"
  }
  if (tone === "warning") return "等待你的审批"
  if (tone === "danger") return "需要处理"
  return agent.model_name || "空闲中"
}

/** 相对时间：1 分钟内「刚刚」，当天按分钟 / 小时，跨天显示月日 */
export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "暂无记录"
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return "暂无记录"
  const diff = Date.now() - time
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(time))
}

/** 绝对日期：仅用于详情面板「加入时间」 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "暂无记录"
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return "暂无记录"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(time)
}

import type { Agent } from "@/types/agent"
import type { IntegrationNode } from "@/types/integration"

export const ROLE_ORDER: Record<string, number> = {
  project_architect: 0,
  agent_engineer: 1,
  frontend_designer: 2,
  knowledge_manager: 3,
  qa_engineer: 4,
  operations_engineer: 5,
}

export const ROLE_LABELS: Record<string, string> = {
  project_architect: "项目总设计师",
  agent_engineer: "Agent工程师",
  frontend_designer: "前端设计师",
  knowledge_manager: "知识库管理员",
  qa_engineer: "测试专员",
  operations_engineer: "运维",
}

export const ROLE_ALIASES: Record<string, string[]> = {
  project_architect: ["架构师", "总设计师", "项目总设计师", "方案设计"],
  agent_engineer: ["后端工程师", "后端", "后台"],
  frontend_designer: ["前端", "UI", "视觉"],
  knowledge_manager: ["知识库", "资料管理员", "文档管理员"],
  qa_engineer: ["测试", "测试工程师", "QA", "质量审核"],
  operations_engineer: ["运维工程师", "运维", "SRE"],
}

export interface MentionMatch {
  start: number
  query: string
}

export interface MentionEntry {
  key: string
  name: string
  kind: "agent" | "integration"
  avatar: string | null
  subtitle: string
  role?: string
  roleLabel?: string
  aliases?: string[]
  description?: string
  status: string
}

/**
 * Detect mention trigger character (@ or fullwidth ＠) before the caret.
 * Supports triggering in Chinese sentences without requiring preceding whitespace.
 * Excludes email addresses where @ is preceded by ASCII alphanumeric characters.
 */
export function findMention(value: string, caret: number): MentionMatch | null {
  const beforeCaret = value.slice(0, caret)
  const lastHalfAt = beforeCaret.lastIndexOf("@")
  const lastFullAt = beforeCaret.lastIndexOf("＠")
  const lastAt = Math.max(lastHalfAt, lastFullAt)
  if (lastAt === -1) {
    return null
  }

  // If immediately preceded by ASCII word character, treat as email address / word identifier
  if (lastAt > 0 && /[a-zA-Z0-9_]/.test(beforeCaret[lastAt - 1])) {
    return null
  }

  const queryPart = beforeCaret.slice(lastAt + 1)
  // If there is whitespace or another @ symbol between the trigger and the caret, dismiss the menu
  if (/[\s@＠]/.test(queryPart)) {
    return null
  }

  return {
    start: lastAt,
    query: queryPart.toLocaleLowerCase("zh-CN"),
  }
}

/**
 * Build sorted list of mentionable entries from agents and external integration nodes.
 */
export function buildMentionEntries(
  agents: Agent[],
  integrationNodes: IntegrationNode[] = [],
): MentionEntry[] {
  const orderedAgents = [...agents].sort(
    (left, right) =>
      (ROLE_ORDER[left.role] ?? Number.MAX_SAFE_INTEGER) -
      (ROLE_ORDER[right.role] ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name, "zh-CN"),
  )

  const agentEntries: MentionEntry[] = orderedAgents.map((agent) => ({
    key: `agent-${agent.id}`,
    name: agent.name,
    kind: "agent",
    avatar: agent.avatar,
    subtitle: agent.model_name,
    role: agent.role,
    roleLabel: ROLE_LABELS[agent.role] ?? agent.role,
    aliases: ROLE_ALIASES[agent.role] ?? [],
    description: agent.description,
    status: agent.status,
  }))

  const nodeEntries: MentionEntry[] = integrationNodes.map((node) => ({
    key: `node-${node.id}`,
    name: node.name,
    kind: "integration",
    avatar: node.name.slice(0, 1),
    subtitle: node.provider,
    role: "integration",
    roleLabel: "外部节点",
    aliases: [node.provider],
    description: `外部集成节点 (${node.provider})`,
    status: node.status,
  }))

  return [...agentEntries, ...nodeEntries]
}

/**
 * Filter entries by query matching name, role, role label, aliases, model subtitle, or description.
 */
export function filterMentionEntries(
  entries: MentionEntry[],
  query: string,
): MentionEntry[] {
  const q = query.trim().toLocaleLowerCase("zh-CN")
  if (!q) {
    return entries
  }

  return entries.filter((entry) => {
    const matchName = entry.name.toLocaleLowerCase("zh-CN").includes(q)
    const matchSubtitle = entry.subtitle.toLowerCase().includes(q)
    const matchRole = entry.role?.toLowerCase().includes(q)
    const matchRoleLabel = entry.roleLabel?.toLocaleLowerCase("zh-CN").includes(q)
    const matchDesc = entry.description?.toLocaleLowerCase("zh-CN").includes(q)
    const matchAliases = entry.aliases?.some((alias) =>
      alias.toLocaleLowerCase("zh-CN").includes(q),
    )
    return Boolean(
      matchName ||
        matchSubtitle ||
        matchRole ||
        matchRoleLabel ||
        matchDesc ||
        matchAliases,
    )
  })
}

/**
 * Replace mention text in textarea with chosen entry name and calculate next caret position.
 */
export function insertMention(
  value: string,
  caret: number,
  mention: MentionMatch,
  entryName: string,
): { nextValue: string; nextCaret: number } {
  const prefix = value.slice(0, mention.start)
  const suffix = value.slice(caret)
  const replacement = `@${entryName} `
  const nextValue = `${prefix}${replacement}${suffix}`
  const nextCaret = prefix.length + replacement.length
  return { nextValue, nextCaret }
}

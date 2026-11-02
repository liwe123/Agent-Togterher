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

/** @ 前后允许出现的字符：邮箱 / 路径等标识符语境直接跳过，避免误伤。 */
const ADDRESS_BEFORE = /[A-Za-z0-9_./]/
const NAME_GOES_ON = /[A-Za-z0-9_]/
/** 群发语义不转成个人链接（DS-Bot 只处理具名 Agent）。 */
const RESERVED_MENTION_NAMES = new Set(["all", "everyone", "所有人", "全体"])

interface MentionTarget {
  id: number
  name: string
  lowerName: string
}

function markRange(mask: Uint8Array, start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    mask[index] = 1
  }
}

/**
 * 标记不应识别 @ 的「字面量区」：围栏代码块、行内代码、Markdown 链接。
 * 这样 `@Name` 出现在代码或链接里时保持原样，不会破坏 Markdown 结构。
 */
function buildLiteralMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length)

  // 1) 围栏代码块：成对的 ``` 之间全部视为字面量；未闭合时剩余正文都算代码。
  let cursor = 0
  while (cursor < text.length) {
    const open = text.indexOf("```", cursor)
    if (open === -1) break
    const close = text.indexOf("```", open + 3)
    if (close === -1) {
      markRange(mask, open, text.length)
      break
    }
    markRange(mask, open, close + 3)
    cursor = close + 3
  }

  // 2) 行内代码：单行内成对的单个反引号。
  const inlineCode = /`[^`\n]*`/g
  for (const match of text.matchAll(inlineCode)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    let overlapped = false
    for (let index = start; index < end; index += 1) {
      if (mask[index]) {
        overlapped = true
        break
      }
    }
    if (!overlapped) {
      markRange(mask, start, end)
    }
  }

  // 3) Markdown 链接 / 图片：`[文案](地址)` 内部不做 @ 识别。
  const markdownLink = /!?\[[^\]]*\]\([^)]*\)/g
  for (const match of text.matchAll(markdownLink)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    let overlapped = false
    for (let index = start; index < end; index += 1) {
      if (mask[index]) {
        overlapped = true
        break
      }
    }
    if (!overlapped) {
      markRange(mask, start, end)
    }
  }

  return mask
}

/**
 * 把正文里的已知 Agent 提及转成行内引用 Markdown：`@Name` → `[Name](mention://<id>)`。
 *
 * 对齐 DS-Bot 的 @ 解析口径（分析报告 §4.1）：
 * - 只识别已知 Agent 名（含中文名），按名字长度降序匹配，短名不会抢长名的前缀；
 * - 跳过围栏代码块 / 行内代码 / Markdown 链接内部；
 * - 排除邮箱、路径前缀（前一个字符是 `[A-Za-z0-9_./]`）与名字后紧跟标识符的误匹配；
 * - `@所有人` 等群发语义保持纯文本；
 * - selfId 命中的 Agent 不转链接（避免消息里自指）；
 * - 其余文本原样保留，可安全交给 ReactMarkdown 渲染。
 */
export function linkMentions(
  text: string,
  agents: Array<{ id: number; name: string }>,
  selfId?: number | null,
): string {
  if (!text || agents.length === 0) return text

  const targets: MentionTarget[] = []
  const seenNames = new Set<string>()
  for (const agent of agents) {
    if (!agent || typeof agent.name !== "string") continue
    const name = agent.name.trim()
    if (!name) continue
    const lowerName = name.toLowerCase()
    if (RESERVED_MENTION_NAMES.has(lowerName)) continue
    if (seenNames.has(lowerName)) continue
    seenNames.add(lowerName)
    targets.push({ id: agent.id, name, lowerName })
  }
  if (targets.length === 0) return text
  targets.sort(
    (left, right) =>
      right.name.length - left.name.length || left.id - right.id,
  )

  const mask = buildLiteralMask(text)
  let result = ""
  let copied = 0
  let index = 0

  while (index < text.length) {
    const marker = text[index]
    if ((marker !== "@" && marker !== "＠") || mask[index]) {
      index += 1
      continue
    }

    if (index > 0 && ADDRESS_BEFORE.test(text[index - 1])) {
      index += 1
      continue
    }

    const rest = text.slice(index + 1)
    const restLower = rest.toLowerCase()
    let matched: MentionTarget | null = null
    for (const target of targets) {
      if (!restLower.startsWith(target.lowerName)) continue
      const end = index + 1 + target.name.length
      const after = text.charAt(end)
      if (after && NAME_GOES_ON.test(after)) continue
      let literal = false
      for (let position = index + 1; position < end; position += 1) {
        if (mask[position]) {
          literal = true
          break
        }
      }
      if (literal) continue
      matched = target
      break
    }

    if (!matched) {
      index += 1
      continue
    }

    const end = index + 1 + matched.name.length
    const display = text.slice(index + 1, end)
    result += text.slice(copied, index)
    if (selfId !== undefined && selfId !== null && matched.id === selfId) {
      // 自指保持纯文本，但仍消费掉这段，避免被更短的名字二次匹配。
      result += `${marker}${display}`
    } else {
      result += `[${display}](mention://${matched.id})`
    }
    copied = end
    index = end
  }

  result += text.slice(copied)
  return result
}

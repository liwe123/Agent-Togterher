/**
 * 群聊多 Agent 接力与聊天时间线的纯函数工具。
 *
 * 参考 DS-Bot 的群聊信息架构（发言顺序、消息分组、时间分隔）实现，
 * 不依赖 React，便于用 node --test 直接覆盖（见 tests/relay-utils.test.mjs）。
 */

import type { Agent } from "@/types/agent"
import type {
  ChatMessage,
  ChatTask,
  RelayHopStatus,
  RelayProgressEvent,
} from "@/types/chat"
import type { MentionEntry } from "@/lib/mention-utils"

export const RELAY_MAX_HOPS = 6

const GROUP_GAP_MS = 5 * 60 * 1000
const DIVIDER_GAP_MS = 30 * 60 * 1000
const ASCII_WORD = /[a-zA-Z0-9_]/

export interface RelayHopView {
  agentId: number
  name: string
  state: "pending" | "active" | "done" | "passed" | "failed"
}

export interface RelayTaskProgress {
  totalHops: number
  hops: Record<number, RelayHopStatus>
}

export interface TimelineEntry {
  message: ChatMessage
  groupStart: boolean
  groupEnd: boolean
  showTime: boolean
  dayLabel: string | null
  relayHop: { index: number; total: number } | null
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

/**
 * 维度时间分隔文案：今天 / 昨天 / M月D日（跨年补年份）。
 */
export function formatDayDivider(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ""
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days === 0) return "今天"
  if (days === 1) return "昨天"
  const prefix = date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`
  return `${prefix}${date.getMonth() + 1}月${date.getDate()}日`
}

function toMentionCandidates(entries: MentionEntry[]): { term: string; entry: MentionEntry }[] {
  const candidates: { term: string; entry: MentionEntry }[] = []
  for (const entry of entries) {
    const terms = new Set<string>([entry.name, ...(entry.aliases ?? [])])
    for (const term of terms) {
      if (term && term.trim()) candidates.push({ term: term.trim(), entry })
    }
  }
  return candidates.sort((left, right) => right.term.length - left.term.length)
}

function matchMentionAt(
  text: string,
  at: number,
  candidates: { term: string; entry: MentionEntry }[],
): { term: string; entry: MentionEntry } | null {
  const rest = text.slice(at + 1)
  const restLower = rest.toLowerCase()
  for (const candidate of candidates) {
    const termLower = candidate.term.toLowerCase()
    if (!restLower.startsWith(termLower)) continue
    const next = rest.charAt(candidate.term.length)
    if (candidate.term.charAt(candidate.term.length - 1).match(ASCII_WORD) && next && next.match(ASCII_WORD)) {
      continue
    }
    return candidate
  }
  return null
}

/**
 * 按出现顺序提取文本中所有有效 @ 目标（去重），与后端 MessageHub 的解析口径对齐：
 * 支持全角 ＠、中文无空格语境、最长候选优先、排除邮箱与英文词内误匹配。
 */
export function extractMentionEntries(
  text: string,
  entries: MentionEntry[],
): MentionEntry[] {
  if (!text || entries.length === 0) return []
  const candidates = toMentionCandidates(entries)
  const result: MentionEntry[] = []
  const seen = new Set<string>()
  let position = 0
  while (position < text.length) {
    let at = -1
    for (let index = position; index < text.length; index += 1) {
      const char = text[index]
      if (char === "@" || char === "＠") {
        at = index
        break
      }
    }
    if (at < 0) break
    if (at > 0 && text[at - 1].match(ASCII_WORD)) {
      position = at + 1
      continue
    }
    const matched = matchMentionAt(text, at, candidates)
    if (matched === null) {
      position = at + 1
      continue
    }
    if (!seen.has(matched.entry.key)) {
      seen.add(matched.entry.key)
      result.push(matched.entry)
    }
    position = at + 1 + matched.term.length
  }
  return result
}

/**
 * 输入框接力顺序预览：仅内部 Agent、数量 ≥ 2 时形成接力链，上限 RELAY_MAX_HOPS。
 */
export function buildRelayChainPreview(
  text: string,
  entries: MentionEntry[],
): MentionEntry[] {
  const agents = extractMentionEntries(text, entries).filter((entry) => entry.kind === "agent")
  if (agents.length < 2) return []
  return agents.slice(0, RELAY_MAX_HOPS)
}

/**
 * 由接力链与实时进度推导每一棒的可视状态（待执行 / 进行中 / 已完成 / 已跳过 / 失败）。
 */
export function deriveRelayHops(
  chainAgentIds: number[],
  agents: Agent[],
  progress?: RelayTaskProgress,
  taskStatus?: string,
): RelayHopView[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  return chainAgentIds.map((agentId, index) => {
    const hopIndex = index + 1
    const status = progress?.hops[hopIndex]
    const agent = agentsById.get(agentId)
    let state: RelayHopView["state"] = "pending"
    if (status === "completed") state = "done"
    else if (status === "passed") state = "passed"
    else if (status === "failed") state = "failed"
    else if (status === "started") state = "active"
    else if (taskStatus === "failed" && progress?.hops[hopIndex] === undefined && index === 0 && !progress) {
      state = "failed"
    }
    return {
      agentId,
      name: agent?.name ?? `Agent #${agentId}`,
      state,
    }
  })
}

export interface RelayProgressReducer {
  [taskId: number]: RelayTaskProgress
}

/**
 * 把一条 task.relay_progress 事件合并进进度表（不可变更新）。
 */
export function applyRelayProgress(
  current: RelayProgressReducer,
  event: RelayProgressEvent,
): RelayProgressReducer {
  const previous = current[event.task_id]
  return {
    ...current,
    [event.task_id]: {
      totalHops: event.total_hops,
      hops: { ...(previous?.hops ?? {}), [event.hop_index]: event.status },
    },
  }
}

/**
 * 为历史与实时消息补上接力棒次徽标：按接力任务的创建/完成时间窗，
 * 把该任务链上成员的回复按顺序匹配到对应棒次（PASS 棒没有消息，自然跳过）。
 */
export function assignRelayHops(
  messages: ChatMessage[],
  tasks: ChatTask[],
): Map<number, { index: number; total: number }> {
  const result = new Map<number, { index: number; total: number }>()
  const relayTasks = tasks
    .filter((task) => (task.relay_agent_ids?.length ?? 0) >= 2)
    .slice()
    .sort((left, right) => left.id - right.id)

  for (const task of relayTasks) {
    const chain = task.relay_agent_ids ?? []
    const start = Date.parse(task.created_at)
    const end = Date.parse(task.updated_at)
    const candidates = messages.filter((message) => {
      if (message.sender_type !== "agent" || message.sender_id === null) return false
      if (!chain.includes(message.sender_id)) return false
      if (result.has(message.id)) return false
      const created = Date.parse(message.created_at)
      if (Number.isNaN(created)) return false
      if (!Number.isNaN(start) && created < start - 1000) return false
      if (!Number.isNaN(end) && created > end + 5000) return false
      return true
    })

    let cursor = 0
    for (const message of candidates.sort((left, right) => left.id - right.id)) {
      const hopIndex = chain.indexOf(message.sender_id as number)
      if (hopIndex < 0) continue
      if (hopIndex < cursor) continue
      cursor = hopIndex + 1
      result.set(message.id, { index: hopIndex + 1, total: chain.length })
    }
  }
  return result
}

/**
 * 构造消息时间线：时间分隔、发送者分组（同人连续消息合并）与接力棒次。
 */
export function buildMessageTimeline(
  messages: ChatMessage[],
  options: { now?: Date; relayHops?: Map<number, { index: number; total: number }> } = {},
): TimelineEntry[] {
  const now = options.now ?? new Date()
  const relayHops = options.relayHops ?? new Map()
  const entries: TimelineEntry[] = []

  messages.forEach((message, index) => {
    const created = toDate(message.created_at)
    const previous = index > 0 ? messages[index - 1] : null
    const previousCreated = previous ? toDate(previous.created_at) : null
    const isSystemLike = message.sender_type === "system" || message.message_type === "error"

    let divider = false
    if (!previousCreated || Number.isNaN(created.getTime())) {
      divider = index === 0
    } else {
      divider =
        !sameDay(previousCreated, created) ||
        created.getTime() - previousCreated.getTime() >= DIVIDER_GAP_MS
    }

    const grouped =
      previous !== null &&
      !isSystemLike &&
      previous.sender_type === message.sender_type &&
      previous.sender_id === message.sender_id &&
      previous.message_type === message.message_type &&
      previousCreated !== null &&
      !Number.isNaN(previousCreated.getTime()) &&
      !Number.isNaN(created.getTime()) &&
      created.getTime() - previousCreated.getTime() < GROUP_GAP_MS

    const groupStart = !grouped
    if (groupStart) {
      // 上一分组收尾。
      const last = entries[entries.length - 1]
      if (last) last.groupEnd = true
    }

    entries.push({
      message,
      groupStart,
      groupEnd: false,
      showTime: isSystemLike,
      dayLabel: divider ? formatDayDivider(created, now) : null,
      relayHop: relayHops.get(message.id) ?? null,
    })
  })

  const last = entries[entries.length - 1]
  if (last) last.groupEnd = true
  for (const entry of entries) {
    entry.showTime = entry.showTime || entry.groupEnd
  }
  return entries
}

/** 相对时间文案（成员面板的最近活跃）。 */
export function formatRelativeTime(value: string | null, now: Date = new Date()): string {
  if (!value) return "暂无活跃记录"
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return "暂无活跃记录"
  const diff = now.getTime() - date.getTime()
  if (diff < 60_000) return "刚刚活跃"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return formatDayDivider(date, now)
}

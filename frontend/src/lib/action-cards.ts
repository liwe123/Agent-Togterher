/**
 * 动作卡（ActionCard）与任务人工审批的纯函数工具。
 *
 * 对齐 DS-Bot 的「同一时刻只有一张卡可交互」与「行内卡 / 浮层卡只出现一次」语义
 * （分析报告 §3.3 / §4.4），不依赖 React，便于用 node --test 直接覆盖。
 */

import type { ChatMessage, ChatTask } from "@/types/chat"

export type ActionTone = "default" | "danger" | "accent"
export type ActionKind = "action" | "note" | "link"

export interface ActionOption {
  /** 键帽字母：A/B/C…（与键盘选择一致）。 */
  key: string
  label: string
  description?: string
  tone?: ActionTone
  kind?: ActionKind
  /** kind=link 时的目标地址。 */
  href?: string
}

export const ACTION_KEYS = ["A", "B", "C", "D", "E"] as const

/** 把键盘输入折算成选项下标：A/a/ａ → 0，非选项键 → null。 */
export function actionIndexFromKey(key: string): number | null {
  const normalized = key.trim().toUpperCase()
  if (!normalized) return null
  const index = (ACTION_KEYS as readonly string[]).indexOf(normalized)
  return index === -1 ? null : index
}

/** 键盘事件目标是否处于可编辑区域（输入框 / 文本域 / 下拉 / contenteditable）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false
  const element = target as {
    tagName?: unknown
    isContentEditable?: unknown
    closest?: unknown
  }
  const tagName = typeof element.tagName === "string" ? element.tagName.toUpperCase() : ""
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true
  }
  if (element.isContentEditable === true) return true
  if (typeof element.closest === "function") {
    const editable = (element.closest as (selector: string) => Element | null)(
      "[contenteditable='true'], [contenteditable=''], [role='textbox']",
    )
    return editable !== null
  }
  return false
}

export interface ActionCardArbiter {
  register(id: string): void
  unregister(id: string): void
  activeId(): string | null
  isActive(id: string): boolean
}

/**
 * 单卡仲裁：记录挂载顺序，同一时刻只有「最新挂载」的那张卡响应键盘。
 * 卡片卸载后自动回退到上一张仍挂载的卡。
 */
export function createActionCardArbiter(): ActionCardArbiter {
  let sequence = 0
  const order = new Map<string, number>()

  function activeId(): string | null {
    let current: string | null = null
    let currentSequence = -1
    for (const [id, value] of order) {
      if (value > currentSequence) {
        current = id
        currentSequence = value
      }
    }
    return current
  }

  return {
    register(id: string) {
      sequence += 1
      order.set(id, sequence)
    },
    unregister(id: string) {
      order.delete(id)
    },
    activeId,
    isActive(id: string) {
      return activeId() === id
    },
  }
}

export interface ApprovalPlacement {
  /** 行内卡：key = 触发该任务的消息 id。 */
  inlineByMessageId: Map<number, ChatTask>
  /** 浮层卡：没有可挂载消息（或消息不在当前列表中）的待审批任务。 */
  dock: ChatTask[]
}

/** 当前仍在等待人工审批的任务，按创建顺序稳定排序。 */
export function pendingApprovalTasks(tasks: ChatTask[]): ChatTask[] {
  return tasks
    .filter((task) => task.status === "waiting_approval")
    .sort((left, right) => left.id - right.id)
}

/**
 * 计算待审批任务卡片的落位：
 * - 任务有 input_message_id 且该消息当前可见 → 行内渲染（同一消息只挂一张卡）；
 * - 否则进入 composer 上方的浮层 dock；
 * - 用户主动「稍后处理」的任务整卡收起，不再重复出现。
 */
export function collectApprovalPlacement(
  tasks: ChatTask[],
  messages: ChatMessage[],
  dismissed: ReadonlySet<number> = new Set<number>(),
): ApprovalPlacement {
  const visibleMessageIds = new Set(messages.map((message) => message.id))
  const inlineByMessageId = new Map<number, ChatTask>()
  const dock: ChatTask[] = []

  for (const task of pendingApprovalTasks(tasks)) {
    if (dismissed.has(task.id)) continue
    const messageId = task.input_message_id
    if (
      messageId !== null &&
      visibleMessageIds.has(messageId) &&
      !inlineByMessageId.has(messageId)
    ) {
      inlineByMessageId.set(messageId, task)
      continue
    }
    dock.push(task)
  }

  return { inlineByMessageId, dock }
}

/** 审批动作卡的键帽选项：A 批准 / B 驳回 / C 自定义说明。 */
export function buildApprovalOptions(): ActionOption[] {
  return [
    {
      key: "A",
      label: "批准并继续",
      description: "恢复任务并继续执行最终汇总",
      tone: "accent",
      kind: "action",
    },
    {
      key: "B",
      label: "驳回任务",
      description: "任务标记为失败（人工驳回），不再继续",
      tone: "danger",
      kind: "action",
    },
    {
      key: "C",
      label: "自定义说明",
      description: "展开输入审批意见（仅本会话可见，不入库）",
      tone: "default",
      kind: "note",
    },
  ]
}

/** 动作卡在单卡仲裁中的稳定 id（同一任务同一时刻最多一张卡）。 */
export function approvalCardId(taskId: number): string {
  return `approval-task-${taskId}`
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { MousePointerClick, X } from "@/components/ui/icons"

import { AgentPortrait } from "@/components/console/agent-portrait"
import {
  agentRoleLabel,
  agentStatusDotClass,
  agentStatusLabel,
  formatDate,
  formatRelativeTime,
} from "@/components/console/agent-meta"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

const PANEL_WIDTH_KEY = "console.panelW"
const PANEL_MIN_WIDTH = 320
const PANEL_MAX_WIDTH = 520
const PANEL_DEFAULT_WIDTH = 320
const PANEL_KEYBOARD_STEP = 16
const PANEL_WIDTH_CSS_VAR = "--console-panel-w"

type PanelTab = "details" | "stats"

const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: "details", label: "详情" },
  { id: "stats", label: "统计" },
]

function clampPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return PANEL_DEFAULT_WIDTH
  return Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(value)))
}

function readStoredPanelWidth(): number {
  if (typeof window === "undefined") return PANEL_DEFAULT_WIDTH
  try {
    const stored = window.localStorage.getItem(PANEL_WIDTH_KEY)
    if (stored === null) return PANEL_DEFAULT_WIDTH
    return clampPanelWidth(Number(stored))
  } catch {
    return PANEL_DEFAULT_WIDTH
  }
}

/**
 * 右侧对象详情面板（控制台 xl 常驻 / 群聊页复用）。
 * 无选中对象时显示空态；Escape 关闭；左缘 8px 手柄可拖拽 320–520px 并持久化。
 */
export function DetailsPanel({
  agent,
  open,
  onClose,
}: {
  agent: Agent | null
  open: boolean
  onClose: () => void
}) {
  const [width, setWidth] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [tabSelection, setTabSelection] = useState<{
    agentId: number | null
    tab: PanelTab
  }>({ agentId: null, tab: "details" })
  const [renameHintAgentId, setRenameHintAgentId] = useState<
    number | null | undefined
  >(undefined)

  const panelRef = useRef<HTMLElement>(null)
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  )
  const widthRef = useRef(PANEL_DEFAULT_WIDTH)

  const agentId = agent?.id ?? null
  const activeTab: PanelTab =
    tabSelection.agentId === agentId ? tabSelection.tab : "details"
  const showRenameHint = renameHintAgentId !== undefined && renameHintAgentId === agentId

  // 打开时读取本地宽度并写入面板自身的 CSS 变量（避免 SSR / 水合不一致）
  useEffect(() => {
    if (!open) return
    const stored = readStoredPanelWidth()
    widthRef.current = stored
    panelRef.current?.style.setProperty(PANEL_WIDTH_CSS_VAR, `${stored}px`)
  }, [open])

  // Escape 关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  // 改名占位提示 1.8s 后自动消失
  useEffect(() => {
    if (renameHintAgentId === undefined) return
    const timer = window.setTimeout(() => setRenameHintAgentId(undefined), 1800)
    return () => window.clearTimeout(timer)
  }, [renameHintAgentId])

  // 拖拽期间锁定全局光标 / 选中，卸载时兜底恢复
  useEffect(() => {
    return () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [])

  const applyWidth = useCallback((nextWidth: number) => {
    const clamped = clampPanelWidth(nextWidth)
    widthRef.current = clamped
    setWidth(clamped)
    panelRef.current?.style.setProperty(PANEL_WIDTH_CSS_VAR, `${clamped}px`)
  }, [])

  const persistWidth = useCallback((value: number) => {
    try {
      window.localStorage.setItem(
        PANEL_WIDTH_KEY,
        String(clampPanelWidth(value)),
      )
    } catch {
      // 隐私模式下 localStorage 不可用时忽略，宽度仍在本会话内生效
    }
  }, [])

  const handleDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = { startX: event.clientX, startWidth: widthRef.current }
    setIsDragging(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  const handleDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState) return
    applyWidth(dragState.startWidth + dragState.startX - event.clientX)
  }

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return
    dragStateRef.current = null
    setIsDragging(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    persistWidth(widthRef.current)
  }

  const handleGripKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const delta =
      event.key === "ArrowLeft" ? PANEL_KEYBOARD_STEP : -PANEL_KEYBOARD_STEP
    applyWidth(widthRef.current + delta)
    persistWidth(widthRef.current)
  }

  const selectTab = (tab: PanelTab) => {
    setTabSelection({ agentId, tab })
  }

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const nextTab: PanelTab = activeTab === "details" ? "stats" : "details"
    selectTab(nextTab)
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    )
    buttons[nextTab === "details" ? 0 : 1]?.focus()
  }

  if (!open) return null

  const activeTabIndex = PANEL_TABS.findIndex((tab) => tab.id === activeTab)
  const panelStyle: CSSProperties = {
    width: width === null ? "var(--console-panel-w, 320px)" : `${width}px`,
  }

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label="Agent 详情面板"
      className="relative hidden shrink-0 flex-col border-l border-console-line bg-console-surface xl:flex"
      style={panelStyle}
    >
      {/* 左缘拖拽手柄：hover / 拖拽时显示 2px accent 竖线 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整详情面板宽度"
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        aria-valuenow={width ?? undefined}
        tabIndex={0}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={handleGripKeyDown}
        className="console-grip group absolute top-0 left-0 z-20 flex h-full w-2 touch-none items-center justify-center hover:bg-transparent focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-full w-0.5 origin-center scale-y-0 rounded-full bg-console-accent transition-transform duration-[var(--console-dur-list,190ms)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
            "group-hover:scale-y-100 group-focus-visible:scale-y-100",
            isDragging && "scale-y-100",
          )}
        />
      </div>

      {/* 顶部操作排：36px 圆钮 */}
      <div className="flex h-12 shrink-0 items-center justify-end gap-1 px-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭详情面板"
          title="关闭详情面板（Esc）"
          className="flex size-9 items-center justify-center rounded-full text-console-ink-2 transition-colors duration-[var(--console-dur-tap,290ms)] hover:bg-console-hover hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/60 motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
        >
          <X aria-hidden="true" className="size-4.5" />
        </button>
      </div>

      {agent ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 对象头 */}
          <div className="flex shrink-0 flex-col items-center gap-2 px-5 pb-4 text-center">
            <AgentPortrait agent={agent} index={agent.id} size="xl" showStatusDot={false} />
            <div className="flex min-w-0 flex-col items-center gap-0.5">
              <button
                type="button"
                onClick={() => setRenameHintAgentId(agentId)}
                title="重命名（即将支持）"
                className="max-w-full truncate rounded-md px-1 text-[15px] font-semibold leading-5 text-console-ink transition-colors hover:text-console-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/60"
              >
                {agent.name}
              </button>
              <p className="console-meta max-w-full truncate">
                {agentRoleLabel(agent.role)} · {agentStatusLabel(agent.status)}
              </p>
              {showRenameHint ? (
                <p role="status" className="console-meta text-console-warn">
                  重命名功能即将上线
                </p>
              ) : null}
            </div>
          </div>

          {/* 分段 tab */}
          <div
            role="tablist"
            aria-label="详情面板视图"
            onKeyDown={handleTabKeyDown}
            className="relative mx-4 grid shrink-0 grid-cols-2 rounded-full border border-console-line bg-console-surface-2 p-0.5"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-8 rounded-full bg-console-active transition-[left] duration-[var(--console-dur-tap,290ms)] ease-[var(--console-ease-tap,ease-out)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none"
              style={{
                left: activeTabIndex === 0 ? "2px" : "calc(50% + 0px)",
                width: "calc(50% - 2px)",
                top: "2px",
              }}
            />
            {PANEL_TABS.map((tab) => {
              const selected = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`details-panel-tab-${tab.id}`}
                  aria-selected={selected}
                  aria-controls={`details-panel-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    "relative z-10 h-8 rounded-full text-[13px] font-medium transition-colors duration-[var(--console-dur-list,190ms)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/60 motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
                    selected
                      ? "text-console-ink"
                      : "text-console-ink-3 hover:text-console-ink-2",
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* 内容 */}
          <div className="console-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5">
            {activeTab === "details" ? (
              <section
                role="tabpanel"
                id="details-panel-panel-details"
                aria-labelledby="details-panel-tab-details"
                className="flex flex-col gap-3"
              >
                <DetailRow label="模型" mono value={agent.model_name || "未绑定模型"} />
                <DetailRow label="状态">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn("size-2 rounded-full", agentStatusDotClass(agent.status))}
                    />
                    {agentStatusLabel(agent.status)}
                  </span>
                </DetailRow>
                <DetailRow
                  label="最近活跃"
                  tabular
                  value={formatRelativeTime(agent.last_active_at)}
                />
                <DetailRow label="工作区" tabular value={`#${agent.workspace_id}`} />
                <div className="border-b border-console-line pb-3 last:border-b-0 last:pb-0">
                  <p className="text-[12px] leading-[18px] text-console-ink-3">描述</p>
                  <p className="mt-1 text-[13px] leading-[20px] text-console-ink-2">
                    {agent.description || "暂无描述"}
                  </p>
                </div>
              </section>
            ) : (
              <section
                role="tabpanel"
                id="details-panel-panel-stats"
                aria-labelledby="details-panel-tab-stats"
                className="flex flex-col gap-2.5"
              >
                <div className="grid grid-cols-2 gap-2.5">
                  <StatTile label="最近活跃" value={formatRelativeTime(agent.last_active_at)} />
                  <StatTile label="状态" value={agentStatusLabel(agent.status)} />
                  <StatTile label="加入时间" value={formatDate(agent.created_at)} />
                  <StatTile label="工作区" value={`#${agent.workspace_id}`} />
                </div>
                <p className="console-meta leading-5">
                  更多运行统计（对话轮次、Token、耗时）将在后续版本接入。
                </p>
              </section>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-console-raised text-console-ink-3">
            <MousePointerClick aria-hidden="true" className="size-5" />
          </span>
          <p className="text-[13px] font-medium leading-[18px] text-console-ink-2">
            未选择对象
          </p>
          <p className="console-meta">从左侧团队列选择一位 Agent</p>
        </div>
      )}
    </aside>
  )
}

function DetailRow({
  label,
  value,
  mono = false,
  tabular = false,
  children,
}: {
  label: string
  value?: string
  mono?: boolean
  tabular?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-console-line pb-3 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-[12px] leading-[18px] text-console-ink-3">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-[13px] leading-[18px] text-console-ink",
          mono && "truncate font-mono text-[13px]",
          tabular && "console-tabular",
        )}
      >
        {children ?? value}
      </span>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-console-line bg-console-surface-2 px-3 py-2.5">
      <p className="text-[12px] leading-[16px] text-console-ink-3">{label}</p>
      <p className="console-tabular mt-1 truncate text-[13px] leading-[20px] text-console-ink">
        {value}
      </p>
    </div>
  )
}

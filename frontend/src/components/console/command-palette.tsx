"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  ContactRound,
  LayoutDashboard,
  ListTodo,
  MessageCircleMore,
  Moon,
  Search,
  Settings,
  Sun,
  Workflow,
  X,
} from "@/components/ui/icons"

import { AgentPortrait } from "@/components/console/agent-portrait"
import { agentRoleLabel } from "@/components/console/agent-meta"
import { SkeletonRows } from "@/components/ui/feedback"
import { useAppearance } from "@/hooks/use-appearance"
import { useTeamRoster } from "@/hooks/use-team-roster"
import { cn } from "@/lib/utils"
import type { Agent } from "@/types/agent"

type CommandGroupId = "page" | "agent" | "action"

interface CommandItem {
  id: string
  group: CommandGroupId
  title: string
  subtitle?: string
  icon?: ReactNode
  agent?: Agent
  run: () => void
}

interface CommandGroup {
  id: CommandGroupId
  label: string
  items: CommandItem[]
}

const GROUP_LABELS: Record<CommandGroupId, string> = {
  page: "页面",
  agent: "Agent",
  action: "操作",
}

function matchesQuery(item: CommandItem, query: string): boolean {
  if (!query) return true
  const normalized = query.toLocaleLowerCase("zh-CN")
  return (
    item.title.toLocaleLowerCase("zh-CN").includes(normalized) ||
    Boolean(item.subtitle?.toLocaleLowerCase("zh-CN").includes(normalized))
  )
}

/**
 * 全局命令面板（Ctrl / Cmd + K）：
 * 分组「页面 / Agent / 操作」，↑↓ 移动、Enter 执行、Esc / 点遮罩关闭。
 * 由 AppProviders 挂载，自带全局快捷键监听。
 */
export function CommandPalette() {
  const router = useRouter()
  const { mode, setMode } = useAppearance()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [previousFocus, setPreviousFocus] = useState<HTMLElement | null>(null)
  const roster = useTeamRoster({ enabled: open })

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const openPalette = useCallback(() => {
    setPreviousFocus(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    )
    setQuery("")
    setActiveIndex(0)
    setOpen(true)
  }, [])

  const closePalette = useCallback(() => {
    setOpen(false)
    const target = previousFocus
    window.requestAnimationFrame(() => {
      if (target && typeof target.focus === "function") target.focus()
    })
  }, [previousFocus])

  const togglePalette = useCallback(() => {
    if (open) {
      closePalette()
      return
    }
    openPalette()
  }, [open, closePalette, openPalette])

  // 全局 Ctrl / Cmd + K 与 Esc 监听
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        togglePalette()
        return
      }
      if (event.key === "Escape" && open) {
        event.preventDefault()
        closePalette()
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown)
    return () => window.removeEventListener("keydown", handleGlobalKeyDown)
  }, [open, togglePalette, closePalette])

  // 打开后聚焦输入框
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const navigateTo = useCallback(
    (href: string) => {
      closePalette()
      router.push(href)
    },
    [closePalette, router],
  )

  const pageItems = useMemo<CommandItem[]>(
    () => [
      {
        id: "page-console",
        group: "page",
        title: "控制台",
        subtitle: "集群总览 · Agent 运行状态",
        icon: <LayoutDashboard aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/"),
      },
      {
        id: "page-chats",
        group: "page",
        title: "群聊",
        subtitle: "与团队 Agent 实时协作",
        icon: <MessageCircleMore aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/chats"),
      },
      {
        id: "page-tasks",
        group: "page",
        title: "任务",
        subtitle: "任务队列与执行结果",
        icon: <ListTodo aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/tasks"),
      },
      {
        id: "page-workflows",
        group: "page",
        title: "工作流",
        subtitle: "多 Agent 协作流水线",
        icon: <Workflow aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/workflows"),
      },
      {
        id: "page-contacts",
        group: "page",
        title: "通讯录",
        subtitle: "工作区 Agent 目录",
        icon: <ContactRound aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/contacts"),
      },
      {
        id: "page-settings",
        group: "page",
        title: "设置",
        subtitle: "工作区、外观与用量",
        icon: <Settings aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/settings"),
      },
    ],
    [navigateTo],
  )

  const agentItems = useMemo<CommandItem[]>(
    () =>
      roster.agents.map((agent) => ({
        id: `agent-${agent.id}`,
        group: "agent",
        title: agent.name,
        subtitle: `${agentRoleLabel(agent.role)} · ${agent.model_name || "未绑定模型"}`,
        agent,
        run: () =>
          navigateTo(`/chats?mention=${encodeURIComponent(agent.name)}`),
      })),
    [roster.agents, navigateTo],
  )

  const actionItems = useMemo<CommandItem[]>(() => {
    const nextMode = mode === "dark" ? "light" : "dark"
    return [
      {
        id: "action-mode",
        group: "action",
        title: mode === "dark" ? "切换为浅色模式" : "切换为深色模式",
        subtitle: `外观 · 当前${mode === "dark" ? "深色" : "浅色"}`,
        icon:
          mode === "dark" ? (
            <Sun aria-hidden="true" className="size-4" />
          ) : (
            <Moon aria-hidden="true" className="size-4" />
          ),
        run: () => {
          setMode(nextMode)
          closePalette()
        },
      },
      {
        id: "action-settings",
        group: "action",
        title: "打开设置",
        subtitle: "前往设置页 · 外观与工作区",
        icon: <Settings aria-hidden="true" className="size-4" />,
        run: () => navigateTo("/settings"),
      },
    ]
  }, [mode, setMode, closePalette, navigateTo])

  const groups = useMemo<CommandGroup[]>(() => {
    const pageGroupItems = pageItems.filter((item) => matchesQuery(item, query))
    const agentGroupItems = agentItems.filter((item) => matchesQuery(item, query))
    const actionGroupItems = actionItems.filter((item) => matchesQuery(item, query))
    const result: CommandGroup[] = []
    if (pageGroupItems.length > 0) {
      result.push({ id: "page", label: GROUP_LABELS.page, items: pageGroupItems })
    }
    if (agentGroupItems.length > 0 || roster.isLoading || roster.error !== null) {
      result.push({ id: "agent", label: GROUP_LABELS.agent, items: agentGroupItems })
    }
    if (actionGroupItems.length > 0) {
      result.push({ id: "action", label: GROUP_LABELS.action, items: actionGroupItems })
    }
    return result
  }, [pageItems, agentItems, actionItems, query, roster.isLoading, roster.error])

  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const safeActiveIndex =
    flatItems.length === 0 ? 0 : Math.min(activeIndex, flatItems.length - 1)
  const activeItem = flatItems[safeActiveIndex] ?? null
  const activeOptionId = activeItem ? `command-option-${activeItem.id}` : undefined
  const isEmpty = flatItems.length === 0

  // 选中项保持在可视区内
  useEffect(() => {
    if (!open) return
    const container = listRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>(
      `[data-command-index="${safeActiveIndex}"]`,
    )
    active?.scrollIntoView({ block: "nearest" })
  }, [open, safeActiveIndex])

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (flatItems.length === 0) return
      setActiveIndex((safeActiveIndex + 1) % flatItems.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      if (flatItems.length === 0) return
      setActiveIndex((safeActiveIndex - 1 + flatItems.length) % flatItems.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      flatItems[safeActiveIndex]?.run()
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      closePalette()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-console-bg/70 px-4 pt-[12vh] console-fade-in sm:pt-[16vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closePalette()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="console-card console-slide-up flex w-[min(560px,92vw)] flex-col overflow-hidden rounded-[18px] shadow-2xl"
      >
        {/* 搜索输入 */}
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-console-line px-4">
          <Search aria-hidden="true" className="size-4 shrink-0 text-console-ink-3" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-label="搜索页面、Agent 或操作"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索页面、Agent 或操作…"
            className="h-full w-full bg-transparent text-[15px] leading-5 text-console-ink placeholder:text-console-ink-3 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => {
                setQuery("")
                setActiveIndex(0)
                inputRef.current?.focus()
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-console-ink-3 transition-colors hover:bg-console-hover hover:text-console-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-console-accent/60"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          ) : (
            <kbd className="console-kbd shrink-0">Esc</kbd>
          )}
        </div>

        {/* 结果列表 */}
        <div
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          aria-label="命令结果"
          className="console-scroll max-h-[402px] min-h-[64px] overflow-y-auto p-1.5"
        >
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
              <Search aria-hidden="true" className="size-8 text-console-ink-3" />
              <div className="flex flex-col gap-1">
                <p className="text-[13px] leading-[18px] font-medium text-console-ink-2">
                  没有匹配的结果
                </p>
                <p className="console-meta">试试搜索页面、Agent 或操作</p>
              </div>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.label}>
                <p className="px-2.5 pt-2 pb-1 text-[11px] leading-4 font-semibold tracking-wide text-console-ink-3">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const index = flatItems.indexOf(item)
                  const selected = index === safeActiveIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      id={`command-option-${item.id}`}
                      aria-selected={selected}
                      data-command-index={index}
                      data-active={selected}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => item.run()}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-[var(--console-dur-list,190ms)] motion-reduce:transition-none [html[data-motion=quiet]_&]:transition-none",
                        selected
                          ? "bg-console-active text-console-ink"
                          : "text-console-ink-2 hover:bg-console-hover hover:text-console-ink",
                      )}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-console-raised text-console-ink-2">
                        {item.agent ? (
                          <AgentPortrait
                            agent={item.agent}
                            index={item.agent.id}
                            size="xxs"
                            showStatusDot={false}
                          />
                        ) : (
                          item.icon
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[14px] leading-5 text-console-ink">
                          {item.title}
                        </span>
                        {item.subtitle ? (
                          <span className="truncate text-[12px] leading-4 text-console-ink-3">
                            {item.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {selected ? (
                        <kbd className="console-kbd shrink-0">↵</kbd>
                      ) : null}
                    </button>
                  )
                })}
                {group.id === "agent" && roster.isLoading ? (
                  <div className="px-2.5 py-2">
                    <SkeletonRows rows={2} />
                  </div>
                ) : null}
                {group.id === "agent" && !roster.isLoading && roster.error ? (
                  <div className="flex items-start gap-1.5 px-2.5 py-2">
                    <AlertCircle
                      aria-hidden="true"
                      className="mt-0.5 size-3.5 shrink-0 text-console-danger"
                    />
                    <p className="console-meta break-words">
                      Agent 列表加载失败：{roster.error}
                    </p>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {/* 快捷键提示 */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-console-line px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="console-kbd">↑</kbd>
              <kbd className="console-kbd">↓</kbd>
              <span className="console-meta">选择</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="console-kbd">↵</kbd>
              <span className="console-meta">执行</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="console-kbd">Esc</kbd>
              <span className="console-meta">关闭</span>
            </span>
          </div>
          <span className="console-meta hidden sm:inline">Ctrl / ⌘ + K</span>
        </div>
      </div>
    </div>
  )
}

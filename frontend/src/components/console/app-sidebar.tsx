import {
  Activity,
  ContactRound,
  LayoutDashboard,
  ListTodo,
  MessageCircleMore,
  Settings,
  TerminalSquare,
} from "lucide-react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import type { ConnectionStatus } from "@/types/agent"

const navigation = [
  { id: "console", label: "控制台", icon: LayoutDashboard, href: "/" },
  { id: "chats", label: "群聊", icon: MessageCircleMore, href: "/chats" },
  { id: "contacts", label: "通讯录", icon: ContactRound, href: "#通讯录" },
  { id: "tasks", label: "任务", icon: ListTodo, href: "/tasks" },
  { id: "settings", label: "设置", icon: Settings, href: "/settings" },
] as const

const connectionLabels: Record<ConnectionStatus, string> = {
  connecting: "正在连接",
  online: "WebSocket 已连接",
  offline: "WebSocket 未连接",
}

interface AppSidebarProps {
  connectionStatus: ConnectionStatus
  activeItem?: (typeof navigation)[number]["id"]
}

export function AppSidebar({
  connectionStatus,
  activeItem = "console",
}: AppSidebarProps) {
  return (
    <aside className="flex min-w-0 overflow-hidden border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:min-h-svh md:flex-col md:border-r md:border-b-0">
      <div className="flex min-w-52 shrink-0 items-center gap-3 px-4 py-4 md:min-w-0 md:px-5 md:py-6">
        <span className="relative flex size-9 items-center justify-center rounded-md border border-sidebar-primary/45 bg-sidebar-primary/8 text-sidebar-primary">
          <TerminalSquare aria-hidden="true" className="size-[18px]" />
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-sidebar bg-[var(--status-running)]" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight">Agent Console</span>
          <span className="hidden text-[10px] text-muted-foreground md:block">协同运行台</span>
        </span>
      </div>

      <nav aria-label="主导航" className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-2 md:flex-col md:items-stretch md:overflow-visible md:px-3 md:py-2">
        {navigation.map((item) => {
          const Icon = item.icon
          const isActive = item.id === activeItem
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "order-first bg-sidebar-accent text-sidebar-accent-foreground md:order-none"
                  : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute left-1.5 size-1 rounded-[2px] transition-colors",
                  isActive ? "bg-sidebar-primary" : "bg-transparent group-hover:bg-sidebar-border",
                )}
                aria-hidden="true"
              />
              <Icon aria-hidden="true" className={cn("size-4", isActive && "text-sidebar-primary")} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="hidden border-t border-sidebar-border px-5 py-4 md:flex md:items-center md:gap-3">
        <span
          className="status-dot size-2 rounded-full"
          data-status={connectionStatus}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs font-medium">
            {connectionLabels[connectionStatus]}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Activity aria-hidden="true" className="size-3" />
            工作区实时通道
          </span>
        </div>
      </div>
    </aside>
  )
}

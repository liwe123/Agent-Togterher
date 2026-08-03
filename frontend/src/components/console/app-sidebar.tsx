import {
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
  { id: "contacts", label: "通讯录", icon: ContactRound, href: "/contacts" },
  { id: "tasks", label: "任务", icon: ListTodo, href: "/tasks" },
  { id: "settings", label: "设置", icon: Settings, href: "/settings" },
] as const

interface AppSidebarProps {
  connectionStatus: ConnectionStatus
  activeItem?: (typeof navigation)[number]["id"]
}

export function AppSidebar({
  connectionStatus,
  activeItem = "console",
}: AppSidebarProps) {
  return (
    <>
      <aside className="hidden min-h-svh flex-col items-center overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-[72px] w-full items-center justify-center border-b border-sidebar-border">
          <Link href="/" className="group relative flex size-10 items-center justify-center rounded-xl border border-sidebar-primary/40 bg-sidebar-primary/10 text-sidebar-primary shadow-[0_0_15px_rgba(19,206,124,0.15)] transition-all hover:scale-105">
            <TerminalSquare aria-hidden="true" className="size-[20px] transition-transform group-hover:rotate-6" />
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-[var(--status-running)] shadow-[0_0_6px_var(--status-running)]" aria-hidden="true" />
          </Link>
        </div>

        <nav aria-label="主导航" className="flex flex-1 flex-col items-center gap-2.5 py-6">
          {navigation.map((item) => {
            const Icon = item.icon
            const isActive = item.id === activeItem
            return (
              <Link
                key={item.label}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex size-11 items-center justify-center rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary shadow-[0_0_12px_color-mix(in_oklch,var(--sidebar-primary)_20%,transparent)]"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground hover:scale-105",
                )}
              >
                <span
                  className={cn(
                    "absolute -left-[17px] h-6 w-[3.5px] rounded-r-full transition-all duration-300",
                    isActive ? "bg-sidebar-primary shadow-[0_0_8px_var(--sidebar-primary)]" : "bg-transparent scale-y-0 group-hover:bg-sidebar-primary/40 group-hover:scale-y-50",
                  )}
                  aria-hidden="true"
                />
                <Icon aria-hidden="true" className="size-[20px]" />
              </Link>
            )
          })}
        </nav>

        <div className="flex h-16 w-full items-center justify-center border-t border-sidebar-border" title={connectionStatus === "online" ? "实时通道已连接" : "实时通道未连接"}>
          <span className="status-dot size-2.5 rounded-full" data-status={connectionStatus} aria-hidden="true" />
        </div>
      </aside>

      {activeItem !== "chats" ? (
        <nav aria-label="移动端导航" className="mobile-tab-bar fixed right-0 bottom-0 left-0 z-40 grid grid-cols-5 border-t border-sidebar-border bg-sidebar/90 backdrop-blur-md px-2 pt-1.5 text-sidebar-foreground md:hidden">
          {navigation.map((item) => {
            const Icon = item.icon
            const isActive = item.id === activeItem
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition-colors",
                  isActive ? "text-sidebar-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      ) : null}
    </>
  )
}

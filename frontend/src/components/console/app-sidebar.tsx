import {
  ContactRound,
  LayoutDashboard,
  ListTodo,
  MessageCircleMore,
  Settings,
  Sparkles,
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
      {/* Desktop M3 Navigation Rail */}
      <aside className="hidden min-h-svh flex-col items-center overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-[72px] w-full items-center justify-center border-b border-sidebar-border/60">
          <Link
            href="/"
            aria-label="返回控制台首页"
            className="group relative flex size-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-[0_2px_12px_color-mix(in_oklch,var(--primary)_20%,transparent)] transition-all duration-200 hover:scale-105 hover:bg-primary/20 active:scale-95"
          >
            <Sparkles aria-hidden="true" className="size-5 transition-transform duration-300 group-hover:rotate-12" />
            <span
              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-[var(--status-running)] shadow-[0_0_6px_var(--status-running)]"
              aria-hidden="true"
            />
          </Link>
        </div>

        <nav aria-label="主导航" className="flex flex-1 flex-col items-center gap-3 py-6">
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
                  "group flex flex-col items-center gap-1 text-center transition-all duration-200 focus-visible:outline-none",
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200",
                    isActive
                      ? "bg-primary/22 text-primary shadow-[0_0_12px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
                      : "text-muted-foreground group-hover:bg-secondary/70 group-hover:text-foreground group-hover:scale-105 group-active:scale-95",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium transition-colors duration-200",
                    isActive ? "font-semibold text-primary" : "text-muted-foreground/90 group-hover:text-foreground",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>

        <div
          className="flex h-16 w-full items-center justify-center border-t border-sidebar-border/60"
          title={connectionStatus === "online" ? "实时通道已连接" : "实时通道未连接"}
        >
          <span className="status-dot size-2.5 rounded-full" data-status={connectionStatus} aria-hidden="true" />
        </div>
      </aside>

      {/* Mobile M3 Bottom Navigation Bar */}
      {activeItem !== "chats" ? (
        <nav
          aria-label="移动端导航"
          className="mobile-tab-bar fixed right-0 bottom-0 left-0 z-40 grid grid-cols-5 border-t border-sidebar-border/80 bg-sidebar/95 backdrop-blur-xl px-2 pt-2 text-sidebar-foreground md:hidden"
        >
          {navigation.map((item) => {
            const Icon = item.icon
            const isActive = item.id === activeItem
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-all active:scale-95",
                  isActive ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-all duration-200",
                    isActive ? "bg-primary/20 text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      ) : null}
    </>
  )
}

"use client"

import { AlertCircle, ArrowLeft, MessagesSquare, Radio, UsersRound } from "lucide-react"
import Link from "next/link"

import { ChatComposer } from "@/components/chat/chat-composer"
import { MessageList } from "@/components/chat/message-list"
import { AppSidebar } from "@/components/console/app-sidebar"
import { ErrorBoundary } from "@/components/error-boundary"
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useChat } from "@/hooks/use-chat"
import { useIntegrations } from "@/hooks/use-integrations"

const connectionLabels = {
  connecting: "连接中",
  online: "实时在线",
  offline: "连接断开",
}

export function ChatPage() {
  const {
    workspace,
    conversation,
    agents,
    messages,
    tasks,
    connectionStatus,
    isLoading,
    isSending,
    error,
    retry,
    sendMessage,
  } = useChat()

  const { nodes: integrationNodes } = useIntegrations(workspace?.id ?? null)

  return (
    <div className="chat-shell grid h-svh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="chats" />

      <ErrorBoundary>
        <main className="console-main mobile-chat-main flex min-h-0 flex-col px-0 py-0 md:px-8 md:py-7 xl:px-10">
          <div className="mx-auto flex min-h-0 w-full max-w-[1520px] flex-1 flex-col gap-4">
            <header className="hidden shrink-0 items-center justify-between gap-4 md:flex">
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-[1.85rem] font-bold tracking-[-0.03em] text-foreground">协作频道</h1>
                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                  {workspace
                    ? `${workspace.name} · 多 Agent 实时群聊协同`
                    : "多 Agent 实时群聊协同"}
                </p>
              </div>
              <Badge
                className="connection-chip"
                variant={connectionStatus === "offline" ? "destructive" : "outline"}
              >
                <span
                  className="status-dot size-1.5 rounded-full"
                  data-status={connectionStatus}
                  aria-hidden="true"
                />
                {connectionLabels[connectionStatus]}
              </Badge>
            </header>

            {error && !conversation ? (
              <section className="flex min-h-0 flex-1 items-center justify-center rounded-3xl border border-destructive/35 bg-card/80 p-6 shadow-sm">
                <div className="flex max-w-md flex-col items-center gap-4 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                    <AlertCircle aria-hidden="true" className="size-5" />
                  </span>
                  <div className="space-y-1.5">
                    <h2 className="text-base font-semibold text-foreground">无法打开群聊</h2>
                    <p className="text-sm leading-6 text-muted-foreground">{error}</p>
                  </div>
                  <Button type="button" variant="outline" className="rounded-full" onClick={retry}>
                    重新连接
                  </Button>
                </div>
              </section>
            ) : (
              <section className="console-panel flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 bg-card/90 md:rounded-3xl md:border shadow-sm">
                <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-card/90 px-4 md:hidden">
                  <Link href="/" aria-label="返回控制台" className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
                    <ArrowLeft aria-hidden="true" className="size-5" />
                  </Link>
                  <div className="min-w-0 text-center">
                    <h1 className="truncate text-base font-semibold text-foreground">{conversation?.title ?? "默认群聊"}</h1>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{agents.length} 位 Agent 在线协作</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="relative flex size-9 items-center justify-center text-muted-foreground">
                      <MessagesSquare aria-hidden="true" className="size-5" />
                      {messages.length > 0 ? <span className="absolute top-0 right-0 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{Math.min(messages.length, 9)}</span> : null}
                    </span>
                    <span className="relative flex size-9 items-center justify-center text-muted-foreground">
                      <UsersRound aria-hidden="true" className="size-5" />
                      <span className="absolute -right-0.5 bottom-0 text-[9px]">{agents.length}</span>
                    </span>
                  </div>
                </div>

                <div className="hidden shrink-0 items-center justify-between gap-4 border-b border-border/60 px-6 py-4 md:flex bg-card/40">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                      <MessagesSquare aria-hidden="true" className="size-4.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold sm:text-base text-foreground">
                        {conversation?.title ?? "正在准备默认会话…"}
                      </h2>
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
                        <Radio aria-hidden="true" className="size-3 text-primary" />
                        {agents.length > 0
                          ? `${agents.length} 位 Agent 已就位`
                          : "正在加载 Agent"}
                      </p>
                    </div>
                  </div>

                  {agents.length > 0 && (
                    <AvatarGroup aria-label="会话 Agent">
                      {agents.slice(0, 6).map((agent, index) => (
                        <Avatar
                          key={agent.id}
                          size="sm"
                          className="agent-avatar ring-2 ring-card"
                          data-tone={index % 6}
                          title={agent.name}
                        >
                          <AvatarFallback className="rounded-full">
                            {agent.avatar ?? agent.name.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </AvatarGroup>
                  )}
                </div>

                <MessageList
                  messages={messages}
                  tasks={tasks}
                  agents={agents}
                  isLoading={isLoading}
                />

                <ChatComposer
                  agents={agents}
                  integrationNodes={integrationNodes}
                  disabled={!conversation || Boolean(error)}
                  isSending={isSending}
                  onSend={sendMessage}
                />
              </section>
            )}
          </div>
        </main>
      </ErrorBoundary>
    </div>
  )
}

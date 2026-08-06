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

  return (
    <div className="chat-shell grid h-svh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="chats" />

      <ErrorBoundary>
        <main className="console-main mobile-chat-main flex min-h-0 flex-col px-0 py-0 md:px-8 md:py-7 xl:px-10">
          <div className="mx-auto flex min-h-0 w-full max-w-[1520px] flex-1 flex-col gap-5">
            <header className="hidden shrink-0 items-center justify-between gap-4 md:flex">
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-[1.75rem] font-semibold tracking-[-0.025em]">协作频道</h1>
                <p className="truncate text-xs text-muted-foreground sm:text-sm">
                  {workspace
                    ? `${workspace.name} · 多 Agent 实时协作`
                    : "多 Agent 实时协作"}
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
              <section className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-destructive/35 bg-card/80 p-6">
                <div className="flex max-w-md flex-col items-center gap-4 text-center">
                  <span className="flex size-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                    <AlertCircle aria-hidden="true" className="size-5" />
                  </span>
                  <div className="space-y-1.5">
                    <h2 className="text-base font-semibold">无法打开群聊</h2>
                    <p className="text-sm leading-6 text-muted-foreground">{error}</p>
                  </div>
                  <Button type="button" variant="outline" onClick={retry}>
                    重新连接
                  </Button>
                </div>
              </section>
            ) : (
              <section className="console-panel flex min-h-0 flex-1 flex-col overflow-hidden border-border bg-card/72 md:rounded-xl md:border">
                <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:hidden">
                  <Link href="/" aria-label="返回控制台" className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                    <ArrowLeft aria-hidden="true" className="size-5" />
                  </Link>
                  <div className="min-w-0 text-center">
                    <h1 className="truncate text-base font-semibold">{conversation?.title ?? "默认群聊"}</h1>
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

                <div className="hidden shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4 md:flex">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="section-mark flex size-9 shrink-0 items-center justify-center rounded-md">
                      <MessagesSquare aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold sm:text-base">
                        {conversation?.title ?? "正在准备默认会话…"}
                      </h2>
                      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
                        <Radio aria-hidden="true" className="size-3" />
                        {agents.length > 0
                          ? `${agents.length} 位 Agent 已加入`
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
                          className="agent-avatar"
                          data-tone={index % 6}
                          title={agent.name}
                        >
                          <AvatarFallback>
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

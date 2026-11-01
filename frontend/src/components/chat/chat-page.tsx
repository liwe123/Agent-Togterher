"use client"

import { AlertCircle, ArrowLeft, ChevronDown, UsersRound } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { ChatComposer } from "@/components/chat/chat-composer"
import { ChatMemberPanel } from "@/components/chat/chat-member-panel"
import { MessageList } from "@/components/chat/message-list"
import { RelayChain } from "@/components/chat/relay-chain"
import { AppSidebar } from "@/components/console/app-sidebar"
import { ErrorBoundary } from "@/components/error-boundary"
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
    relayProgress,
    retry,
    sendMessage,
  } = useChat()

  const { nodes: integrationNodes } = useIntegrations(workspace?.id ?? null)
  const [membersOpen, setMembersOpen] = useState(false)
  const toggleMembers = () => setMembersOpen((open) => !open)

  return (
    <div className="chat-shell grid h-svh min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[76px_minmax(0,1fr)]">
      <AppSidebar connectionStatus={connectionStatus} activeItem="chats" />

      <ErrorBoundary>
        <main className="console-main mobile-chat-main flex min-h-0 flex-col px-0 py-0 md:px-8 md:py-6 xl:px-10">
          <div className="mx-auto flex min-h-0 w-full max-w-[1520px] flex-1 flex-col">
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
              <section className="console-panel chat-card flex min-h-0 flex-1 flex-col overflow-hidden border-border/70 bg-card/90 md:rounded-3xl md:border shadow-sm">
                {/* 移动端紧凑头部：返回 + 标题 + 成员入口 */}
                <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-card/90 px-4 md:hidden">
                  <Link
                    href="/"
                    aria-label="返回控制台"
                    className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                  >
                    <ArrowLeft aria-hidden="true" className="size-5" />
                  </Link>
                  <div className="min-w-0 text-center">
                    <h1 className="truncate text-base font-semibold text-foreground">
                      {conversation?.title ?? "默认群聊"}
                    </h1>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {agents.length} 位 Agent 在线协作 · {messages.length} 条消息
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleMembers}
                    aria-label="查看群成员"
                    aria-expanded={membersOpen}
                    aria-controls="chat-member-panel"
                    className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <UsersRound aria-hidden="true" className="size-5" />
                  </button>
                </div>

                {/* 桌面端：DS-Bot 式浮动胶囊头部（会话名 + 成员数 + 实时状态） */}
                <header className="chat-header hidden md:flex">
                  <div className="chat-header-side">
                    <span className="chat-header-eyebrow">协作频道</span>
                    <span className="chat-header-sub">
                      {workspace?.name ?? "多 Agent 实时协作"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={toggleMembers}
                    className="chat-header-pill"
                    aria-expanded={membersOpen}
                    aria-controls="chat-member-panel"
                    title={`${connectionLabels[connectionStatus]} · 点击查看群成员与模型绑定`}
                  >
                    <span
                      className="status-dot size-2 rounded-full"
                      data-status={connectionStatus}
                      aria-hidden="true"
                    />
                    <span className="chat-header-pill-title">
                      {conversation?.title ?? "正在准备默认会话…"}
                    </span>
                    <span className="chat-header-pill-meta">{agents.length} 位成员</span>
                    <ChevronDown
                      aria-hidden="true"
                      className="chat-header-pill-chevron"
                      data-open={membersOpen}
                    />
                  </button>
                  <div className="chat-header-side chat-header-side-right">
                    <span className="chat-header-count">{messages.length} 条消息</span>
                  </div>
                </header>

                <RelayChain tasks={tasks} agents={agents} progress={relayProgress} />

                <div className="chat-stage">
                  <MessageList
                    messages={messages}
                    tasks={tasks}
                    agents={agents}
                    isLoading={isLoading}
                  />
                  {membersOpen && (
                    <ChatMemberPanel
                      agents={agents}
                      onClose={() => setMembersOpen(false)}
                    />
                  )}
                </div>

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

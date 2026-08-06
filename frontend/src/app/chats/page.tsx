import type { Metadata } from "next"
import { Suspense } from "react"

import { ChatPage } from "@/components/chat/chat-page"

export const metadata: Metadata = {
  title: "群聊 · Agent Console",
  description: "与项目 Agent 实时协作并跟踪任务状态",
}

export default function ChatsPage() {
  return (
    <Suspense fallback={<div className="console-shell flex items-center justify-center text-sm text-muted-foreground">正在加载群聊频道…</div>}>
      <ChatPage />
    </Suspense>
  )
}

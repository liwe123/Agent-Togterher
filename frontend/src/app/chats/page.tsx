import type { Metadata } from "next"

import { ChatPage } from "@/components/chat/chat-page"

export const metadata: Metadata = {
  title: "群聊 · Agent Console",
  description: "与项目 Agent 实时协作并跟踪任务状态",
}

export default function ChatsPage() {
  return <ChatPage />
}

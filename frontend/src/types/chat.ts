import type { Agent, ApiResponse } from "@/types/agent"

export type SenderType = "user" | "agent" | "system"
export type MessageType = "normal" | "task" | "receipt" | "error"
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | string

export interface Workspace {
  id: number
  name: string
  description: string
  created_at: string
}

export interface Conversation {
  id: number
  workspace_id: number
  title: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  conversation_id: number
  sender_type: SenderType
  sender_id: number | null
  content: string
  message_type: MessageType
  created_at: string
}

export interface ChatTask {
  id: number
  workspace_id: number
  conversation_id: number | null
  title: string
  description: string
  assigned_agent_id: number | null
  status: TaskStatus
  priority: string
  input_message_id: number | null
  result: string | null
  created_at: string
  updated_at: string
}

export interface MessageHubResult {
  message: ChatMessage
  task: ChatTask
  assigned_agent: Agent
}

export interface ApiErrorResponse {
  success: false
  error: string
}

export type ChatApiResponse<T> = ApiResponse<T> | ApiErrorResponse

export type ChatWorkspaceEvent =
  | { type: "message.created"; payload: ChatMessage }
  | { type: "task.status_changed"; payload: ChatTask }
  | {
      type: "agent.status_changed"
      payload: {
        id: number
        status: Agent["status"]
        last_active_at: string | null
      }
    }
  | { type: "error"; payload: { message: string } }
  | {
      type: "task.step_changed" | "model.call_finished"
      payload: Record<string, unknown>
    }

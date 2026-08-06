export type AgentStatus = "idle" | "running" | "failed" | string

export interface Agent {
  id: number
  workspace_id: number
  name: string
  role: string
  description: string
  avatar: string | null
  model_name: string
  system_prompt: string
  status: AgentStatus
  last_active_at: string | null
  created_at: string
}

export interface ApiResponse<T> {
  success: true
  data: T
}

export type ConnectionStatus = "connecting" | "online" | "offline"

export interface AgentStatusEvent {
  id: number
  status: AgentStatus
  last_active_at: string | null
}

export interface AgentMessageEvent {
  id: number
  sender_type: "user" | "agent" | "system"
  sender_id: number | null
  content: string
  created_at: string
}

export interface RecentOutput {
  id: number
  agentId: number
  content: string
  createdAt: string
}

export type WorkspaceEvent =
  | { type: "agent.status_changed"; payload: AgentStatusEvent }
  | { type: "message.created"; payload: AgentMessageEvent }
  | {
      type:
        | "task.status_changed"
        | "task.step_changed"
        | "model.call_finished"
        | "error"
      payload: unknown
    }

import type { ConnectionStatus } from "@/types/agent"
import type { ChatApiResponse, ChatTask, TaskStatus, Workspace } from "@/types/chat"

export interface TaskAgent {
  id: number
  name: string
  role: string
  avatar: string | null
}

export interface TaskListItem extends ChatTask {
  assigned_agent: TaskAgent | null
}

export interface TaskStep {
  id: number
  task_id: number
  agent_id: number | null
  agent: TaskAgent | null
  step_name: string
  input: string | null
  output: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
}

export interface ModelCall {
  id: number
  task_id: number
  agent_id: number | null
  agent: TaskAgent | null
  model_name: string
  provider: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost: string
  latency_ms: number | null
  status: string
  error_message: string | null
  created_at: string
}

export interface TaskTokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface TaskTraceEvent {
  type: string
  stage: string
  title: string
  actor: string | null
  summary: string
  detail: string | null
  status: string | null
  created_at: string | null
  source_id: number | null
  source_type: string | null
}

export interface TaskDetail extends ChatTask {
  assigned_agent: TaskAgent | null
  original_input: string | null
  task_steps: TaskStep[]
  model_calls: ModelCall[]
  token_usage: TaskTokenUsage
  duration_ms: number | null
  execution_trace: TaskTraceEvent[]
  trace_summary: string | null
  context_snapshot: string | null
}

export type TaskStatusEvent = ChatTask

export type TaskWorkspaceEvent =
  | { type: "task.status_changed"; payload: TaskStatusEvent }
  | { type: "task.step_changed"; payload: Partial<TaskStep> & { task_id: number } }
  | { type: "model.call_finished"; payload: Partial<ModelCall> & { task_id?: number } }
  | {
      type: "task.trace_updated"
      payload: { task_id: number; event: TaskTraceEvent }
    }
  | { type: "error"; payload: { message: string } }
  | {
      type: "workspace.snapshot"
      payload: {
        workspace_id: number
        tasks: Array<Partial<ChatTask>>
        agents: Array<Record<string, unknown>>
        recent_messages: Array<Record<string, unknown>>
      }
    }
  | {
      type: "message.created" | "agent.status_changed"
      payload: Record<string, unknown>
    }

export type { ChatApiResponse, ConnectionStatus, TaskStatus, Workspace }

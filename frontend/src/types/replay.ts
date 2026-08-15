export interface ReplayFrame {
  step_id: number
  step_name: string
  agent_role: string | null
  status: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  input_payload: Record<string, unknown> | null
  output_payload: Record<string, unknown> | null
  error_message: string | null
  model_calls_count: number
  tokens_used: number
  cost_usd: number
}

export interface TaskReplayResponse {
  task_id: number
  title: string
  status: string
  total_duration_ms: number | null
  total_cost_usd: number
  frames: ReplayFrame[]
}

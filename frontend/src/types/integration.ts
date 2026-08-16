export type IntegrationStatus = "connecting" | "online" | "offline" | "busy" | "error" | "removed"

export interface IntegrationNode {
  id: number
  workspace_id: number
  name: string
  provider: string
  mode: string
  status: IntegrationStatus | string
  version: string | null
  capabilities: string[]
  endpoint: string | null
  current_task_count: number
  max_concurrency: number
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

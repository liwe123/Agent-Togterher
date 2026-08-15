export interface AuditLogItem {
  id: number
  workspace_id: number | null
  user_id: number | null
  user_display_name: string | null
  action: string
  resource_type: string
  resource_id: string | null
  detail: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

export interface AuditLogListResponse {
  items: AuditLogItem[]
  total: number
  offset: number
  limit: number
}

export interface QuotaConfig {
  id: number
  workspace_id: number
  monthly_budget_usd: number
  max_monthly_tokens: number
  max_concurrent_tasks: number
  rate_limit_per_minute: number
  is_hard_limit: boolean
  created_at: string
  updated_at: string
}

export interface QuotaUsage {
  workspace_id: number
  monthly_spent_usd: number
  monthly_tokens_used: number
  budget_usd: number
  token_limit: number
  max_concurrent_tasks: number
  is_hard_limit: boolean
  percent_spent: number
  is_exceeded: boolean
}

export interface QuotaConfigUpdate {
  monthly_budget_usd?: number
  max_monthly_tokens?: number
  max_concurrent_tasks?: number
  rate_limit_per_minute?: number
  is_hard_limit?: boolean
}

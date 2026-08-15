export interface CostSummary {
  total_cost_usd: number
  today_cost_usd: number
  month_cost_usd: number
  total_tokens: number
  total_calls: number
  avg_latency_ms: number
}

export interface DailyCostItem {
  date: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number
  call_count: number
}

export interface ModelCostItem {
  model_name: string
  provider: string
  cost_usd: number
  call_count: number
  token_count: number
  percentage: number
}

export interface TopTaskCostItem {
  task_id: number
  task_title: string
  status: string
  cost_usd: number
  total_tokens: number
  model_call_count: number
  created_at: string
}

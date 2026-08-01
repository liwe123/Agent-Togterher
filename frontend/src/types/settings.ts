/** Types for the /settings page. */

export interface ModelConfig {
  name: string
  provider: string
  model: string
  purpose: string
  fallback_model: string | null
}

export interface ProviderStatus {
  provider: string
  configured: boolean
}

/** Status of a provider API key stored via /api/provider-keys. */
export type ProviderKeyStatus = ProviderStatus

export interface ModelTestResult {
  requested_model: string
  model_name: string
  provider: string
  content: string
  response: string
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  latency_ms: number
  fallback_used: boolean
}

export type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; result: ModelTestResult }
  | { status: "error"; error: string }

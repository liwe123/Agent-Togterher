export interface PluginToolDefinition {
  name: string
  description: string
  parameters?: Record<string, unknown>
  endpoint?: string
  method?: string
  plugin_name?: string
}

export interface PluginManifest {
  name: string
  version: string
  display_name: string
  description?: string
  icon?: string
  author?: string
  base_url?: string
  tools?: PluginToolDefinition[]
}

export interface PluginItem {
  id: number
  name: string
  display_name: string
  description?: string | null
  version: string
  icon?: string | null
  author?: string | null
  manifest: PluginManifest
  is_public: boolean
  is_installed: boolean
  is_enabled: boolean
  tools_count: number
  created_at: string
  updated_at: string
}

export interface WorkspacePluginResponse {
  workspace_id: number
  plugin_id: number
  is_enabled: boolean
  config?: Record<string, unknown> | null
  updated_at: string
}

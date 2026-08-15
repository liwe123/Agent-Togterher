export interface WorkflowNode {
  id: string
  name: string
  agent_role: string
  prompt_template: string
  dependencies: string[]
}

export interface WorkflowVariable {
  key: string
  label: string
  description?: string
  default?: string | null
  required?: boolean
}

export interface WorkflowTemplateItem {
  id: number
  workspace_id: number | null
  name: string
  display_name: string
  description: string | null
  icon: string
  is_system: boolean
  nodes: WorkflowNode[]
  variables: WorkflowVariable[]
  nodes_count: number
  created_at: string
  updated_at: string
}

export interface WorkflowRunResponse {
  task_id: number
  workflow_id: number
  title: string
  status: string
  message: string
}

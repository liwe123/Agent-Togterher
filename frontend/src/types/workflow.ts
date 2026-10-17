export interface WorkflowNode {
  id: string
  name: string
  agent_role: string
  prompt_template: string
  dependencies: string[]
  // 后端 WorkflowNode.type 早已存在（agent | human_approval），前端此前缺失，
  // 导致画布无法区分人工审批节点（B2-M3）。
  type?: string
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

/** 运行记录列表项（GET .../workflows/{id}/runs）。 */
export interface WorkflowRunSummary {
  id: number
  template_id: number
  task_id: number
  status: string
  created_at: string
  updated_at: string
  /** 运行时快照的节点数（列表展示用） */
  nodes_count: number
}

/** 单次运行详情：附带运行时节点快照。 */
export interface WorkflowRunDetail extends WorkflowRunSummary {
  nodes: WorkflowNode[]
}

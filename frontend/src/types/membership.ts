export type WorkspaceRole = "owner" | "admin" | "member" | "viewer"

export interface MyWorkspace {
  id: number
  name: string
  description: string
  role: WorkspaceRole
  joined_at: string
}

export interface WorkspaceMember {
  id: number
  user_id: number
  email: string
  display_name: string
  avatar: string | null
  role: WorkspaceRole
  joined_at: string
}

export interface InviteResult {
  invite_code: string
  workspace_id: number
  role: WorkspaceRole
  expires_at: string
}

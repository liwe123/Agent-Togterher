import type { WorkspaceRole } from "@/types/membership"

export function usePermissions(role: WorkspaceRole = "viewer") {
  const isOwner = role === "owner"
  const isAdmin = role === "admin" || isOwner
  const isMember = role === "member" || isAdmin
  const isViewer = role === "viewer"

  return {
    role,
    isOwner,
    isAdmin,
    isMember,
    isViewer,
    canManageMembers: isAdmin,
    canInvite: isAdmin,
    canManageSettings: isAdmin,
    canManageAgents: isAdmin,
    canCreateTasks: isMember,
    canChat: isMember,
    canViewAudit: isAdmin,
    canManageQuota: isOwner,
  }
}

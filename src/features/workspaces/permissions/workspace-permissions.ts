// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — permission matrix
//
// The SINGLE source of truth for role-based capabilities. The UI reads these
// helpers to decide what to show; the server (mock + Supabase) enforces the
// SAME matrix authoritatively. Never scatter permission checks inline.
//
//   OWNER  — manages workspace/members/invites/projects/domains
//   EDITOR — edits and publishes workspace projects, creates projects/links
//   VIEWER — read-only (preview only)
// ---------------------------------------------------------------------------

import type { WorkspaceRole } from "../types";

// ---------------------------------------------------------------------------
// Workspace administration
// ---------------------------------------------------------------------------

/** Rename/delete the workspace, manage members, invites, and roles. */
export function canManageWorkspace(role: WorkspaceRole): boolean {
  return role === "owner";
}

/** Invite members / revoke invitations. */
export function canInviteMembers(role: WorkspaceRole): boolean {
  return canManageWorkspace(role);
}

/** Change a member's role / remove a member. */
export function canChangeRoles(role: WorkspaceRole): boolean {
  return canManageWorkspace(role);
}

/** Leave a workspace without deleting it. */
export function canLeaveWorkspace(role: WorkspaceRole): boolean {
  return role === "editor" || role === "viewer";
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** Create a new project inside the workspace. */
export function canCreateProjects(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor";
}

/** Move a personal project into a workspace. */
export function canMoveProjects(role: WorkspaceRole): boolean {
  return canCreateProjects(role);
}

/** Edit workspace project content (mutations, AI, inline editing). */
export function canEditProject(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor";
}

/** Save workspace project content to the server. */
export function canSaveProject(role: WorkspaceRole): boolean {
  return canEditProject(role);
}

/** Delete a workspace project. */
export function canDeleteProject(role: WorkspaceRole): boolean {
  return role === "owner";
}

/** Duplicate a workspace project within the workspace. */
export function canDuplicateProject(role: WorkspaceRole): boolean {
  return canCreateProjects(role);
}

/** Copy a workspace project into a personal copy (COPY semantics only). */
export function canCopyToPersonal(role: WorkspaceRole): boolean {
  return canCreateProjects(role);
}

// ---------------------------------------------------------------------------
// Publishing / domains / review links
// ---------------------------------------------------------------------------

/** Publish the workspace project. EDITOR is explicitly granted (documented). */
export function canPublishProject(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor";
}

/** Manage custom domains. Owner-only (documented). */
export function canManageDomains(role: WorkspaceRole): boolean {
  return role === "owner";
}

/** Create/manage review links. Owner + editor (documented). */
export function canManageReviewLinks(role: WorkspaceRole): boolean {
  return role === "owner" || role === "editor";
}

// ---------------------------------------------------------------------------
// Editor session gating
// ---------------------------------------------------------------------------

/** True when a role may hold an edit lease / mutate the shared project. */
export function canHoldEditLease(role: WorkspaceRole): boolean {
  return canEditProject(role);
}

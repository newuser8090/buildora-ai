// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — provider interface
//
// The UI never talks to a backend directly; it goes through this provider
// boundary (same pattern as CloudLibraryProvider / ShareLinkProvider).
// Authorization is ALWAYS enforced server-side (RLS + RPCs / mock
// enforcement) — the client never trusts itself.
// ---------------------------------------------------------------------------

import type {
  ActivityCursor,
  LeaseAcquireResult,
  ProjectEditLease,
  ProjectVersionFull,
  ProjectVersionMeta,
  Workspace,
  WorkspaceActivityEvent,
  WorkspaceActivityMetadata,
  WorkspaceActivityType,
  WorkspaceInvitation,
  WorkspaceListing,
  WorkspaceMember,
  WorkspaceProjectFull,
  WorkspaceProjectSaveInput,
  WorkspaceProjectSummary,
  WorkspaceRole,
} from "../types";

export interface WorkspaceSessionUser {
  id: string;
  email: string;
}

export interface CreateWorkspaceInput {
  name: string;
}

export interface WorkspaceProvider {
  readonly kind: "mock" | "supabase";

  /** The currently signed-in user (null when signed out / session invalid). */
  getSessionUser(): Promise<WorkspaceSessionUser | null>;

  // ---- Workspaces ----
  listWorkspaces(): Promise<WorkspaceListing>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(id: string, patch: { name: string }): Promise<Workspace>;
  /** Owner-only; deletes the workspace + projects + members + invites. */
  deleteWorkspace(id: string): Promise<void>;

  // ---- Members ----
  /** Owner + member listing is owner-only by design; members see the roster
   *  through the owner (management UI). Returns members (non-owner) only. */
  listMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  /** Owner: change a member's role (never the last owner). */
  changeMemberRole(
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceRole,
  ): Promise<void>;
  /** Owner: remove a member (never the owner themselves). */
  removeMember(workspaceId: string, memberUserId: string): Promise<void>;
  /** Non-owner leaves a workspace. */
  leaveWorkspace(workspaceId: string): Promise<void>;

  // ---- Invitations ----
  inviteMember(
    workspaceId: string,
    email: string,
    role: "editor" | "viewer",
  ): Promise<WorkspaceInvitation>;
  listInvitations(): Promise<WorkspaceInvitation[]>;
  /** Owner: pending invitations for one workspace. */
  listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]>;
  acceptInvitation(invitationId: string): Promise<void>;
  revokeInvitation(invitationId: string): Promise<void>;

  // ---- Workspace projects (server-authoritative) ----
  listWorkspaceProjects(workspaceId: string): Promise<WorkspaceProjectSummary[]>;
  /** Members (all roles) may fetch. */
  fetchWorkspaceProject(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceProjectFull>;
  /** Owner/editor create a workspace project (payload validated server-side).
   *  `origin` distinguishes "create" from "move-in" for activity. */
  createWorkspaceProject(
    workspaceId: string,
    input: { projectId: string; name: string; project: unknown; origin?: "create" | "move-in" },
  ): Promise<WorkspaceProjectSummary>;
  /** Owner/editor save with optimistic concurrency (STALE_REVISION on miss). */
  saveWorkspaceProject(input: WorkspaceProjectSaveInput): Promise<WorkspaceProjectSummary>;
  /** Owner-only. */
  deleteWorkspaceProject(workspaceId: string, projectId: string): Promise<void>;
  /** Owner/editor duplicate → fresh identity in the same workspace. */
  duplicateWorkspaceProject(
    workspaceId: string,
    projectId: string,
    newProjectId: string,
    name: string,
  ): Promise<WorkspaceProjectSummary>;

  // ---- Edit leases ----
  /** Editor/owner: acquire (or renew own) lease. */
  acquireEditLease(
    workspaceId: string,
    projectId: string,
  ): Promise<LeaseAcquireResult>;
  /** Renew the lease for the current user; rejects stale/invalid leases. */
  heartbeatEditLease(leaseId: string): Promise<ProjectEditLease>;
  /** Best-effort release (only the lease holder may release). */
  releaseEditLease(leaseId: string): Promise<void>;
  /** Resolve the current lease holder for the project (read-only info). */
  getEditLease(workspaceId: string, projectId: string): Promise<ProjectEditLease | null>;
  /** Revoke all leases for a project (used on member removal / workspace delete). */
  revokeLeasesForProject(projectId: string): Promise<void>;

  // ---- Activity (Phase P15) ----
  /**
   * Record a workspace activity event. The SERVER derives the actor from the
   * session; type + metadata are allow-listed server-side. Used by client
   * bridges for publish/share/domain events.
   */
  recordActivityEvent(input: {
    workspaceId: string;
    projectId?: string | null;
    type: WorkspaceActivityType;
    metadata?: WorkspaceActivityMetadata;
  }): Promise<void>;
  /** Paginated activity (createdAt DESC, id DESC). */
  listActivity(input: {
    workspaceId: string;
    before?: ActivityCursor | null;
    limit?: number;
    filter?: string;
  }): Promise<{ events: WorkspaceActivityEvent[]; nextCursor: ActivityCursor | null }>;

  // ---- Project version history (Phase P15) ----
  /** Metadata-only list — snapshots are fetched lazily. Members (all roles). */
  listProjectVersions(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectVersionMeta[]>;
  /** Lazy snapshot fetch. Members (all roles). */
  fetchProjectVersion(
    workspaceId: string,
    projectId: string,
    versionId: string,
  ): Promise<ProjectVersionFull>;
  /** Manual checkpoint of the CURRENT server content (editor/owner with lease). */
  createManualVersion(
    workspaceId: string,
    projectId: string,
    label?: string,
  ): Promise<ProjectVersionMeta>;
  /** Owner-only; expectedRevision-guarded; creates a new revision. */
  restoreProjectVersion(
    workspaceId: string,
    projectId: string,
    versionId: string,
    expectedRevision: number,
  ): Promise<{ revision: number }>;
  /** Owner/editor: fresh-identity copy of a version's content in the workspace. */
  copyProjectFromVersion(
    workspaceId: string,
    projectId: string,
    versionId: string,
    newProjectId: string,
    name: string,
  ): Promise<WorkspaceProjectSummary>;
}

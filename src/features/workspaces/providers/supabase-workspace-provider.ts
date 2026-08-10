// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) —
// SupabaseWorkspaceProvider
//
// Real backend implementation. ALL authorization is enforced in SECURITY
// DEFINER RPCs (see supabase/migrations/20260810000001_workspaces_schema.sql):
// membership-only reads, owner-only management, role-scoped lease
// acquisition, recipient-scoped invitations, optimistic concurrency on
// workspace project saves. The browser only ever holds the anon key.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/features/auth/supabase-client";
import { makeWorkspaceError } from "../errors";
import type {
  LeaseAcquireResult,
  ProjectEditLease,
  Workspace,
  WorkspaceInvitation,
  WorkspaceListing,
  WorkspaceMember,
  WorkspaceProjectFull,
  WorkspaceProjectSaveInput,
  WorkspaceProjectSummary,
  WorkspaceRole,
} from "../types";
import type {
  CreateWorkspaceInput,
  WorkspaceProvider,
  WorkspaceSessionUser,
} from "./workspace-provider";

type WorkspaceErrorCode = import("../types").WorkspaceErrorCode;

export class SupabaseWorkspaceProvider implements WorkspaceProvider {
  readonly kind = "supabase" as const;

  private client(): SupabaseClient {
    const client = getSupabaseClient();
    if (!client) {
      throw makeWorkspaceError("NOT_CONFIGURED", "Workspaces aren't set up yet.");
    }
    return client;
  }

  private async requireRpc<T>(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const client = this.client();
    const { data, error } = await client.rpc(fn, args);
    if (error) throw this.mapError(error.message, error.code);
    return data as T;
  }

  async getSessionUser(): Promise<WorkspaceSessionUser | null> {
    const client = this.client();
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return { id: user.id, email: user.email ?? "" };
  }

  // ---- Workspaces ----
  async listWorkspaces(): Promise<WorkspaceListing> {
    return this.requireRpc<WorkspaceListing>("list_workspaces", {});
  }
  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.requireRpc<Workspace>("create_workspace", { p_name: input.name });
  }
  async updateWorkspace(id: string, patch: { name: string }): Promise<Workspace> {
    return this.requireRpc<Workspace>("update_workspace", {
      p_workspace_id: id,
      p_name: patch.name,
    });
  }
  async deleteWorkspace(id: string): Promise<void> {
    await this.requireRpc("delete_workspace", { p_workspace_id: id });
  }

  // ---- Members ----
  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.requireRpc<WorkspaceMember[]>("list_workspace_members", {
      p_workspace_id: workspaceId,
    });
  }
  async changeMemberRole(
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await this.requireRpc("change_member_role", {
      p_workspace_id: workspaceId,
      p_member_user_id: memberUserId,
      p_role: role,
    });
  }
  async removeMember(workspaceId: string, memberUserId: string): Promise<void> {
    await this.requireRpc("remove_workspace_member", {
      p_workspace_id: workspaceId,
      p_member_user_id: memberUserId,
    });
  }
  async leaveWorkspace(workspaceId: string): Promise<void> {
    await this.requireRpc("leave_workspace", { p_workspace_id: workspaceId });
  }

  // ---- Invitations ----
  async inviteMember(
    workspaceId: string,
    email: string,
    role: "editor" | "viewer",
  ): Promise<WorkspaceInvitation> {
    return this.requireRpc<WorkspaceInvitation>("create_workspace_invitation", {
      p_workspace_id: workspaceId,
      p_email: email,
      p_role: role,
    });
  }
  async listInvitations(): Promise<WorkspaceInvitation[]> {
    return this.requireRpc<WorkspaceInvitation[]>("list_my_workspace_invitations", {});
  }
  async listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return this.requireRpc<WorkspaceInvitation[]>("list_workspace_invitations", {
      p_workspace_id: workspaceId,
    });
  }
  async acceptInvitation(invitationId: string): Promise<void> {
    await this.requireRpc("accept_workspace_invitation", { p_invitation_id: invitationId });
  }
  async revokeInvitation(invitationId: string): Promise<void> {
    await this.requireRpc("revoke_workspace_invitation", { p_invitation_id: invitationId });
  }

  // ---- Workspace projects ----
  async listWorkspaceProjects(workspaceId: string): Promise<WorkspaceProjectSummary[]> {
    return this.requireRpc<WorkspaceProjectSummary[]>("list_workspace_projects", {
      p_workspace_id: workspaceId,
    });
  }
  async fetchWorkspaceProject(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceProjectFull> {
    return this.requireRpc<WorkspaceProjectFull>("fetch_workspace_project", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
    });
  }
  async createWorkspaceProject(
    workspaceId: string,
    input: { projectId: string; name: string; project: unknown },
  ): Promise<WorkspaceProjectSummary> {
    return this.requireRpc<WorkspaceProjectSummary>("create_workspace_project", {
      p_workspace_id: workspaceId,
      p_project_id: input.projectId,
      p_name: input.name,
      p_project: input.project,
    });
  }
  async saveWorkspaceProject(input: WorkspaceProjectSaveInput): Promise<WorkspaceProjectSummary> {
    return this.requireRpc<WorkspaceProjectSummary>("save_workspace_project", {
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_project: input.project,
      p_expected_revision: input.expectedRevision,
    });
  }
  async deleteWorkspaceProject(workspaceId: string, projectId: string): Promise<void> {
    await this.requireRpc("delete_workspace_project", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
    });
  }
  async duplicateWorkspaceProject(
    workspaceId: string,
    projectId: string,
    newProjectId: string,
    name: string,
  ): Promise<WorkspaceProjectSummary> {
    return this.requireRpc<WorkspaceProjectSummary>("duplicate_workspace_project", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
      p_new_project_id: newProjectId,
      p_name: name,
    });
  }

  // ---- Edit leases ----
  async acquireEditLease(workspaceId: string, projectId: string): Promise<LeaseAcquireResult> {
    return this.requireRpc<LeaseAcquireResult>("acquire_edit_lease", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
    });
  }
  async heartbeatEditLease(leaseId: string): Promise<ProjectEditLease> {
    return this.requireRpc<ProjectEditLease>("heartbeat_edit_lease", { p_lease_id: leaseId });
  }
  async releaseEditLease(leaseId: string): Promise<void> {
    await this.requireRpc("release_edit_lease", { p_lease_id: leaseId });
  }
  async getEditLease(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectEditLease | null> {
    return this.requireRpc<ProjectEditLease | null>("get_edit_lease", {
      p_workspace_id: workspaceId,
      p_project_id: projectId,
    });
  }
  async revokeLeasesForProject(projectId: string): Promise<void> {
    await this.requireRpc("revoke_leases_for_project", { p_project_id: projectId });
  }

  // -------------------------------------------------------------------------
  // Error mapping — never leak raw provider messages to users
  // -------------------------------------------------------------------------

  private mapError(message: string, code?: string): ReturnType<typeof makeWorkspaceError> {
    if (code === "PGRST116") {
      return makeWorkspaceError("PERMISSION_DENIED", "You don't have access to that.", code);
    }
    const normalized = message.toLowerCase();
    if (normalized.includes("row-level security")) {
      return makeWorkspaceError("PERMISSION_DENIED", "You don't have access to that.", code);
    }
    if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
      return makeWorkspaceError("RATE_LIMITED", "Too many requests. Try again shortly.", code);
    }
    if (normalized.includes("jwt") || normalized.includes("token")) {
      return makeWorkspaceError("SESSION_EXPIRED", "Your session ended. Sign in again.", code);
    }
    // RPC exception messages carry the canonical code.
    if (isKnownCode(message)) {
      return makeWorkspaceError(message as WorkspaceErrorCode, message, code);
    }
    return makeWorkspaceError(
      "NETWORK_FAILED",
      "The workspace service had a problem. Please try again.",
      code,
    );
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "AUTH_REQUIRED", "PERMISSION_DENIED", "INVALID_NAME", "INVALID_EMAIL",
  "INVALID_ROLE", "INVALID_INPUT", "ALREADY_MEMBER", "INVITE_INVALID",
  "INVITE_EXPIRED", "STALE_REVISION", "LEASE_HELD", "LEASE_INVALID",
  "PROJECT_NOT_FOUND", "PAYLOAD_TOO_LARGE", "PAYLOAD_INVALID", "LAST_OWNER",
]);

function isKnownCode(value: string): boolean {
  return KNOWN_CODES.has(value.trim());
}

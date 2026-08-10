// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — service
//
// Thin, provider-independent service used by the UI (mirrors
// SharedLibraryService / ShareLinkService). All authorization is enforced
// server-side (RLS + RPCs / mock enforcement). Every action returns
// structured errors mapped to beginner-safe copy; malformed provider
// responses degrade to a safe error.
// ---------------------------------------------------------------------------

import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import { toWorkspaceError } from "../errors";
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
  WorkspaceResult,
  WorkspaceRole,
} from "../types";
import type { WorkspaceProvider } from "../providers/workspace-provider";
import { MockHttpWorkspaceProvider } from "../providers/mock-http-workspace-provider";
import { SupabaseWorkspaceProvider } from "../providers/supabase-workspace-provider";

export class WorkspaceService {
  private provider: WorkspaceProvider;

  constructor(provider: WorkspaceProvider) {
    this.provider = provider;
  }

  async getSessionUser(): Promise<{ id: string; email: string } | null> {
    return this.provider.getSessionUser();
  }

  async listWorkspaces(): Promise<WorkspaceResult<WorkspaceListing>> {
    try {
      return { ok: true, value: await this.provider.listWorkspaces() };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async createWorkspace(name: string): Promise<WorkspaceResult<Workspace>> {
    try {
      return { ok: true, value: await this.provider.createWorkspace({ name }) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async updateWorkspace(
    id: string,
    patch: { name: string },
  ): Promise<WorkspaceResult<Workspace>> {
    try {
      return { ok: true, value: await this.provider.updateWorkspace(id, patch) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async deleteWorkspace(id: string): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.deleteWorkspace(id);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async listMembers(workspaceId: string): Promise<WorkspaceResult<WorkspaceMember[]>> {
    try {
      return { ok: true, value: await this.provider.listMembers(workspaceId) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async changeMemberRole(
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.changeMemberRole(workspaceId, memberUserId, role);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async removeMember(
    workspaceId: string,
    memberUserId: string,
  ): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.removeMember(workspaceId, memberUserId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async leaveWorkspace(workspaceId: string): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.leaveWorkspace(workspaceId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async inviteMember(
    workspaceId: string,
    email: string,
    role: "editor" | "viewer",
  ): Promise<WorkspaceResult<WorkspaceInvitation>> {
    try {
      return { ok: true, value: await this.provider.inviteMember(workspaceId, email, role) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async listInvitations(): Promise<WorkspaceResult<WorkspaceInvitation[]>> {
    try {
      return { ok: true, value: await this.provider.listInvitations() };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async listWorkspaceInvitations(
    workspaceId: string,
  ): Promise<WorkspaceResult<WorkspaceInvitation[]>> {
    try {
      return { ok: true, value: await this.provider.listWorkspaceInvitations(workspaceId) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async acceptInvitation(invitationId: string): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.acceptInvitation(invitationId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async revokeInvitation(invitationId: string): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.revokeInvitation(invitationId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async listWorkspaceProjects(
    workspaceId: string,
  ): Promise<WorkspaceResult<WorkspaceProjectSummary[]>> {
    try {
      return { ok: true, value: await this.provider.listWorkspaceProjects(workspaceId) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async fetchWorkspaceProject(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceResult<WorkspaceProjectFull>> {
    try {
      return {
        ok: true,
        value: await this.provider.fetchWorkspaceProject(workspaceId, projectId),
      };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async createWorkspaceProject(
    workspaceId: string,
    input: { projectId: string; name: string; project: unknown },
  ): Promise<WorkspaceResult<WorkspaceProjectSummary>> {
    try {
      return { ok: true, value: await this.provider.createWorkspaceProject(workspaceId, input) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async saveWorkspaceProject(
    input: WorkspaceProjectSaveInput,
  ): Promise<WorkspaceResult<WorkspaceProjectSummary>> {
    try {
      return { ok: true, value: await this.provider.saveWorkspaceProject(input) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async deleteWorkspaceProject(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.deleteWorkspaceProject(workspaceId, projectId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async duplicateWorkspaceProject(
    workspaceId: string,
    projectId: string,
    newProjectId: string,
    name: string,
  ): Promise<WorkspaceResult<WorkspaceProjectSummary>> {
    try {
      return {
        ok: true,
        value: await this.provider.duplicateWorkspaceProject(
          workspaceId,
          projectId,
          newProjectId,
          name,
        ),
      };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async acquireEditLease(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceResult<LeaseAcquireResult>> {
    try {
      return { ok: true, value: await this.provider.acquireEditLease(workspaceId, projectId) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async heartbeatEditLease(leaseId: string): Promise<WorkspaceResult<ProjectEditLease>> {
    try {
      return { ok: true, value: await this.provider.heartbeatEditLease(leaseId) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async releaseEditLease(leaseId: string): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.releaseEditLease(leaseId);
      return { ok: true, value: undefined };
    } catch {
      // Best-effort: an already-expired/released lease is fine to ignore.
      return { ok: true, value: undefined };
    }
  }

  async getEditLease(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceResult<ProjectEditLease | null>> {
    try {
      return { ok: true, value: await this.provider.getEditLease(workspaceId, projectId) };
    } catch (err) {
      return { ok: false, error: toWorkspaceError(err) };
    }
  }

  async revokeLeasesForProject(projectId: string): Promise<WorkspaceResult<void>> {
    try {
      await this.provider.revokeLeasesForProject(projectId);
      return { ok: true, value: undefined };
    } catch {
      return { ok: true, value: undefined };
    }
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

let providerSingleton: WorkspaceProvider | null = null;

/**
 * Get the workspace provider for the current cloud environment, or null when
 * no cloud backend is configured (pure local mode — workspaces unavailable).
 */
export function getWorkspaceProvider(): WorkspaceProvider | null {
  if (providerSingleton) return providerSingleton;
  const env = getCloudEnvironment();
  if (env.kind === "supabase") {
    providerSingleton = new SupabaseWorkspaceProvider();
  } else if (env.kind === "mock") {
    providerSingleton = new MockHttpWorkspaceProvider();
  }
  return providerSingleton;
}

/** Test hook. */
export function setWorkspaceProviderForTests(provider: WorkspaceProvider | null): void {
  providerSingleton = provider;
}

/** True when a workspace backend is available at all (not "none"). */
export function workspaceBackendAvailable(): boolean {
  return getWorkspaceProvider() !== null;
}

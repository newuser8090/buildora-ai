// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) —
// MockHttpWorkspaceProvider (dev/test backend)
//
// Implements WorkspaceProvider against the in-memory mock backend exposed
// through Next.js API routes (/api/workspaces/...). Only active when the
// cloud environment is "mock". The mock backend keeps state server-side so
// E2E can simulate two accounts hitting the same "cloud".
// ---------------------------------------------------------------------------

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
import { getMockSessionToken } from "@/features/cloud-sync/providers/mock-session";
import type {
  CreateWorkspaceInput,
  WorkspaceProvider,
  WorkspaceSessionUser,
} from "./workspace-provider";

interface MockEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

type WorkspaceErrorCode = import("../types").WorkspaceErrorCode;

async function mockFetch<T>(
  path: string,
  options: { method?: string; body?: unknown },
): Promise<T> {
  const token = getMockSessionToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api/workspaces/${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw makeWorkspaceError(
      "NETWORK_FAILED",
      "Couldn't reach the workspace service. Please try again.",
    );
  }

  const envelope = (await response.json().catch(() => null)) as MockEnvelope<T> | null;
  if (response.ok && envelope?.ok) return envelope.data as T;

  const code = envelope?.error?.code ?? "UNKNOWN";
  const message = envelope?.error?.message ?? "This couldn't be completed right now.";
  throw makeWorkspaceError(mapMockErrorCode(code), message, code);
}

function mapMockErrorCode(code: string): WorkspaceErrorCode {
  switch (code) {
    case "AUTH_REQUIRED":
      return "AUTH_REQUIRED";
    case "UNAUTHORIZED":
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
    case "PERMISSION_DENIED":
      return "PERMISSION_DENIED";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_NAME":
      return "INVALID_NAME";
    case "INVALID_EMAIL":
      return "INVALID_EMAIL";
    case "INVALID_ROLE":
      return "INVALID_ROLE";
    case "INVALID_INPUT":
      return "INVALID_INPUT";
    case "ALREADY_MEMBER":
      return "ALREADY_MEMBER";
    case "INVITE_INVALID":
      return "INVITE_INVALID";
    case "INVITE_EXPIRED":
      return "INVITE_EXPIRED";
    case "STALE_REVISION":
      return "STALE_REVISION";
    case "LEASE_HELD":
      return "LEASE_HELD";
    case "LEASE_INVALID":
      return "LEASE_INVALID";
    case "PROJECT_NOT_FOUND":
      return "PROJECT_NOT_FOUND";
    case "PAYLOAD_TOO_LARGE":
      return "PAYLOAD_TOO_LARGE";
    case "PAYLOAD_INVALID":
      return "PAYLOAD_INVALID";
    case "LAST_OWNER":
      return "LAST_OWNER";
    case "NOT_CONFIGURED":
      return "NOT_CONFIGURED";
    default:
      return "UNKNOWN";
  }
}

export class MockHttpWorkspaceProvider implements WorkspaceProvider {
  readonly kind = "mock" as const;

  async getSessionUser(): Promise<WorkspaceSessionUser | null> {
    const token = getMockSessionToken();
    if (!token) return null;
    try {
      const data = await mockFetch<{ user: WorkspaceSessionUser }>("session", {});
      return data.user ?? null;
    } catch {
      return null;
    }
  }

  // ---- Workspaces ----
  async listWorkspaces(): Promise<WorkspaceListing> {
    return mockFetch<WorkspaceListing>("", {});
  }
  async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return mockFetch<Workspace>("", { method: "POST", body: input });
  }
  async updateWorkspace(id: string, patch: { name: string }): Promise<Workspace> {
    return mockFetch<Workspace>(`${id}`, { method: "PATCH", body: patch });
  }
  async deleteWorkspace(id: string): Promise<void> {
    await mockFetch<void>(`${id}`, { method: "DELETE" });
  }

  // ---- Members ----
  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return mockFetch<WorkspaceMember[]>(`${workspaceId}/members`, {});
  }
  async changeMemberRole(
    workspaceId: string,
    memberUserId: string,
    role: WorkspaceRole,
  ): Promise<void> {
    await mockFetch<void>(`${workspaceId}/members/${encodeURIComponent(memberUserId)}`, {
      method: "PATCH",
      body: { role },
    });
  }
  async removeMember(workspaceId: string, memberUserId: string): Promise<void> {
    await mockFetch<void>(`${workspaceId}/members/${encodeURIComponent(memberUserId)}`, {
      method: "DELETE",
    });
  }
  async leaveWorkspace(workspaceId: string): Promise<void> {
    await mockFetch<void>(`${workspaceId}/leave`, { method: "POST" });
  }

  // ---- Invitations ----
  async inviteMember(
    workspaceId: string,
    email: string,
    role: "editor" | "viewer",
  ): Promise<WorkspaceInvitation> {
    return mockFetch<WorkspaceInvitation>(`${workspaceId}/invitations`, {
      method: "POST",
      body: { email, role },
    });
  }
  async listInvitations(): Promise<WorkspaceInvitation[]> {
    return mockFetch<WorkspaceInvitation[]>("invitations", {});
  }
  async listWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return mockFetch<WorkspaceInvitation[]>(`${workspaceId}/invitations`, {});
  }
  async acceptInvitation(invitationId: string): Promise<void> {
    await mockFetch<void>(`invitations/${invitationId}/accept`, { method: "POST" });
  }
  async revokeInvitation(invitationId: string): Promise<void> {
    await mockFetch<void>(`invitations/${invitationId}`, { method: "DELETE" });
  }

  // ---- Workspace projects ----
  async listWorkspaceProjects(workspaceId: string): Promise<WorkspaceProjectSummary[]> {
    return mockFetch<WorkspaceProjectSummary[]>(`${workspaceId}/projects`, {});
  }
  async fetchWorkspaceProject(
    workspaceId: string,
    projectId: string,
  ): Promise<WorkspaceProjectFull> {
    return mockFetch<WorkspaceProjectFull>(
      `${workspaceId}/projects/${encodeURIComponent(projectId)}`,
      {},
    );
  }
  async createWorkspaceProject(
    workspaceId: string,
    input: { projectId: string; name: string; project: unknown },
  ): Promise<WorkspaceProjectSummary> {
    return mockFetch<WorkspaceProjectSummary>(`${workspaceId}/projects`, {
      method: "POST",
      body: input,
    });
  }
  async saveWorkspaceProject(input: WorkspaceProjectSaveInput): Promise<WorkspaceProjectSummary> {
    return mockFetch<WorkspaceProjectSummary>("save", { method: "POST", body: input });
  }
  async deleteWorkspaceProject(workspaceId: string, projectId: string): Promise<void> {
    await mockFetch<void>(`${workspaceId}/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
  }
  async duplicateWorkspaceProject(
    workspaceId: string,
    projectId: string,
    newProjectId: string,
    name: string,
  ): Promise<WorkspaceProjectSummary> {
    return mockFetch<WorkspaceProjectSummary>(
      `${workspaceId}/projects/${encodeURIComponent(projectId)}/duplicate`,
      { method: "POST", body: { newProjectId, name } },
    );
  }

  // ---- Edit leases ----
  async acquireEditLease(workspaceId: string, projectId: string): Promise<LeaseAcquireResult> {
    return mockFetch<LeaseAcquireResult>(
      `${workspaceId}/projects/${encodeURIComponent(projectId)}/lease`,
      { method: "POST" },
    );
  }
  async heartbeatEditLease(leaseId: string): Promise<ProjectEditLease> {
    return mockFetch<ProjectEditLease>(`lease/${leaseId}/heartbeat`, { method: "POST" });
  }
  async releaseEditLease(leaseId: string): Promise<void> {
    await mockFetch<void>(`lease/${leaseId}/release`, { method: "POST" });
  }
  async getEditLease(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectEditLease | null> {
    return mockFetch<ProjectEditLease | null>(
      `${workspaceId}/projects/${encodeURIComponent(projectId)}/lease`,
      {},
    );
  }
  async revokeLeasesForProject(projectId: string): Promise<void> {
    await mockFetch<void>(`lease/project/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
  }
}

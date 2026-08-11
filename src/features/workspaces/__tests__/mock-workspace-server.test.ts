// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — mock workspace
// backend tests
//
// These exercise the SAME authorization semantics as the Supabase
// RLS/SECURITY DEFINER RPCs: membership-only reads, owner-only management,
// recipient-scoped invitations, role-scoped lease acquisition, optimistic
// concurrency, owner invariants, and cross-workspace isolation.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  getMockCloudState,
  resetMockCloudState,
  handleSignup,
} from "@/features/cloud-sync/mock/mock-cloud-server";
import {
  MockWorkspaceError,
  getMockWorkspaceState,
  resetMockWorkspaceState,
  handleCreateWorkspace,
  handleUpdateWorkspace,
  handleDeleteWorkspace,
  handleListWorkspaces,
  handleListMembers,
  handleChangeMemberRole,
  handleRemoveMember,
  handleLeaveWorkspace,
  handleInviteMember,
  handleListInvitations,
  handleAcceptInvitation,
  handleRevokeInvitation,
  handleCreateWorkspaceProject,
  handleListWorkspaceProjects,
  handleFetchWorkspaceProject,
  handleSaveWorkspaceProject,
  handleDeleteWorkspaceProject,
  handleDuplicateWorkspaceProject,
  handleAcquireEditLease,
  handleHeartbeatEditLease,
  handleReleaseEditLease,
  handleGetEditLease,
  handleRevokeLeasesForProject,
  handleCollabJoin,
  handleCollabSend,
} from "../mock/mock-workspace-server";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { Workspace } from "../types";

/** Assert a MockWorkspaceError with the exact code. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`Expected MockWorkspaceError with code ${code}, but nothing was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(MockWorkspaceError);
    expect((err as MockWorkspaceError).code).toBe(code);
  }
}

function signUp(email: string): string {
  const state = getMockCloudState();
  const result = handleSignup(state, { email, password: "secret1" });
  return result.token;
}

function createWorkspace(token: string, name = "Acme Team"): Workspace {
  const state = getMockWorkspaceState();
  return handleCreateWorkspace(state, token, { name });
}

/** A fresh copy of the MOCK_PROJECT fixture under a new id. */
function projectFor(id: string) {
  return JSON.parse(JSON.stringify({ ...MOCK_PROJECT, id }));
}

beforeEach(() => {
  resetMockCloudState();
  resetMockWorkspaceState();
  getMockWorkspaceState();
});

describe("workspace creation + listing", () => {
  it("creates a workspace and lists it as owned", () => {
    const token = signUp("a@example.com");
    const workspace = createWorkspace(token);
    expect(workspace.id).toMatch(/^ws-/);
    expect(workspace.memberRole).toBe("owner");
    const listing = handleListWorkspaces(getMockWorkspaceState(), token);
    expect(listing.owned).toHaveLength(1);
    expect(listing.shared).toHaveLength(0);
  });

  it("rejects empty/oversized names", () => {
    const token = signUp("a@example.com");
    expectCode(
      () => handleCreateWorkspace(getMockWorkspaceState(), token, { name: "  " }),
      "INVALID_NAME",
    );
    expectCode(
      () =>
        handleCreateWorkspace(getMockWorkspaceState(), token, {
          name: "x".repeat(81),
        }),
      "INVALID_NAME",
    );
  });

  it("requires a session", () => {
    expectCode(
      () => handleCreateWorkspace(getMockWorkspaceState(), null, { name: "X" }),
      "AUTH_REQUIRED",
    );
    expectCode(
      () => handleCreateWorkspace(getMockWorkspaceState(), "bogus", { name: "X" }),
      "SESSION_EXPIRED",
    );
  });

  it("only owner can rename or delete", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    expectCode(() => handleUpdateWorkspace(state, tokenB, ws.id, { name: "Hijacked" }), "PERMISSION_DENIED");
    expectCode(() => handleDeleteWorkspace(state, tokenB, ws.id), "PERMISSION_DENIED");
    // Owner can rename.
    const renamed = handleUpdateWorkspace(state, tokenA, ws.id, { name: "Renamed" });
    expect(renamed.name).toBe("Renamed");
  });
});

describe("membership + owner safety", () => {
  it("owner cannot remove themselves (workspace must keep an owner)", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    expectCode(
      () =>
        handleRemoveMember(
          getMockWorkspaceState(),
          token,
          ws.id,
          ws.ownerId, // the owner's own user id
        ),
      "LAST_OWNER",
    );
  });

  it("owner role cannot be changed (owner is not in the member list to change)", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    // The owner is not listed as a changeable member (handleListMembers skips them).
    const members = handleListMembers(state, tokenA, ws.id);
    expect(members.find((m) => m.userId === ws.ownerId)).toBeUndefined();
    // A non-owner (b) cannot change any role.
    expectCode(
      () => handleChangeMemberRole(state, tokenB, ws.id, members[0].userId, "viewer"),
      "PERMISSION_DENIED",
    );
  });

  it("only owner can list members, change roles, remove members", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    expectCode(() => handleListMembers(state, tokenB, ws.id), "PERMISSION_DENIED");
    expectCode(
      () => handleChangeMemberRole(state, tokenB, ws.id, "some-user", "viewer"),
      "PERMISSION_DENIED",
    );
    expectCode(
      () => handleRemoveMember(state, tokenB, ws.id, "some-user"),
      "PERMISSION_DENIED",
    );
  });

  it("editor cannot leave-own workspace; member can leave", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    expectCode(() => handleLeaveWorkspace(state, tokenA, ws.id), "PERMISSION_DENIED");
    handleLeaveWorkspace(state, tokenB, ws.id);
    // After leaving, b has no access.
    expectCode(() => handleListWorkspaceProjects(state, tokenB, ws.id), "PERMISSION_DENIED");
  });
});

describe("invitations", () => {
  it("invites, lists pending for recipient, accepts into the correct role", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const invitation = handleInviteMember(state, tokenA, ws.id, {
      email: "B@Example.com ",
      role: "editor",
    });
    expect(invitation.recipientEmail).toBe("b@example.com");
    expect(invitation.status).toBe("pending");
    // Recipient sees it; a stranger does not.
    expect(handleListInvitations(state, tokenB)).toHaveLength(1);
    expect(handleListInvitations(state, signUp("c@example.com"))).toHaveLength(0);
    handleAcceptInvitation(state, tokenB, invitation.id);
    expect(state.invitations.get(invitation.id)!.status).toBe("accepted");
    const listing = handleListWorkspaces(state, tokenB);
    expect(listing.shared[0].id).toBe(ws.id);
    expect(listing.shared[0].memberRole).toBe("editor");
  });

  it("rejects acceptance by a different account (recipient-scoped)", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const invitation = handleInviteMember(state, tokenA, ws.id, {
      email: "b@example.com",
      role: "editor",
    });
    // c cannot accept b's invitation.
    expectCode(
      () => handleAcceptInvitation(state, signUp("c@example.com"), invitation.id),
      "INVITE_INVALID",
    );
    // Nor can b accept an invitation addressed to c (no cross-workspace trick).
    const invitationForC = handleInviteMember(state, tokenA, ws.id, {
      email: "c@example.com",
      role: "viewer",
    });
    expectCode(
      () => handleAcceptInvitation(state, tokenB, invitationForC.id),
      "INVITE_INVALID",
    );
  });

  it("expired invitations are rejected and marked expired", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const invitation = handleInviteMember(state, tokenA, ws.id, {
      email: "b@example.com",
      role: "editor",
    });
    // Simulate expiry server-side.
    state.invitations.get(invitation.id)!.expiresAt = new Date(
      Date.now() - 1000,
    ).toISOString();
    expectCode(
      () => handleAcceptInvitation(state, tokenB, invitation.id),
      "INVITE_EXPIRED",
    );
  });

  it("revoking an invitation prevents acceptance", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const invitation = handleInviteMember(state, tokenA, ws.id, {
      email: "b@example.com",
      role: "editor",
    });
    handleRevokeInvitation(state, tokenA, invitation.id);
    expectCode(
      () => handleAcceptInvitation(state, tokenB, invitation.id),
      "INVITE_INVALID",
    );
  });

  it("duplicate invites replace prior pending invites; already-members rejected", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const first = handleInviteMember(state, tokenA, ws.id, {
      email: "b@example.com",
      role: "viewer",
    });
    const second = handleInviteMember(state, tokenA, ws.id, {
      email: "b@example.com",
      role: "editor",
    });
    expect(first.id).not.toBe(second.id);
    expect(state.invitations.get(first.id)!.status).toBe("revoked");
    expect(state.invitations.get(second.id)!.status).toBe("pending");
    // Once a member, inviting again fails.
    handleAcceptInvitation(state, tokenB, second.id);
    expectCode(
      () => handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "viewer" }),
      "ALREADY_MEMBER",
    );
  });

  it("owner cannot invite themselves", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    expectCode(
      () => handleInviteMember(getMockWorkspaceState(), token, ws.id, { email: "a@example.com" }),
      "INVALID_EMAIL",
    );
  });

  it("only the owner can invite", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    expectCode(
      () => handleInviteMember(getMockWorkspaceState(), tokenB, ws.id, { email: "c@example.com" }),
      "PERMISSION_DENIED",
    );
  });
});

describe("workspace projects", () => {
  it("creates, lists, fetches, saves with optimistic concurrency", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const state = getMockWorkspaceState();
    const created = handleCreateWorkspaceProject(state, token, ws.id, {
      projectId: "proj-1",
      project: projectFor("proj-1"),
    });
    expect(created.revision).toBe(1);
    expect(handleListWorkspaceProjects(state, token, ws.id)).toHaveLength(1);
    const full = handleFetchWorkspaceProject(state, token, ws.id, "proj-1");
    expect(full.project.id).toBe("proj-1");
    // Save with the right revision succeeds and bumps revision.
    const saved = handleSaveWorkspaceProject(state, token, {
      workspaceId: ws.id,
      projectId: "proj-1",
      project: { ...full.project, name: "Renamed" },
      expectedRevision: 1,
    });
    expect(saved.revision).toBe(2);
    // Stale save (expectedRevision 1) is rejected — never overwrites.
    expectCode(
      () =>
        handleSaveWorkspaceProject(state, token, {
          workspaceId: ws.id,
          projectId: "proj-1",
          project: { ...full.project, name: "Stale" },
          expectedRevision: 1,
        }),
      "STALE_REVISION",
    );
    // The stored name is still the one from the successful save.
    const refetched = handleFetchWorkspaceProject(state, token, ws.id, "proj-1");
    expect(refetched.project.name).toBe("Renamed");
  });

  it("viewer cannot create/save/duplicate workspace projects", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, tokenA, ws.id, {
      projectId: "proj-1",
      project: projectFor("proj-1"),
    });
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "viewer" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    expectCode(
      () => handleCreateWorkspaceProject(state, tokenB, ws.id, {
        projectId: "proj-2",
        project: projectFor("proj-2"),
      }),
      "PERMISSION_DENIED",
    );
    expectCode(
      () =>
        handleSaveWorkspaceProject(state, tokenB, {
          workspaceId: ws.id,
          projectId: "proj-1",
          project: projectFor("proj-1"),
          expectedRevision: 1,
        }),
      "PERMISSION_DENIED",
    );
    expectCode(
      () => handleDuplicateWorkspaceProject(state, tokenB, ws.id, "proj-1", { newProjectId: "proj-3" }),
      "PERMISSION_DENIED",
    );
    // Viewer can still read.
    expect(handleFetchWorkspaceProject(state, tokenB, ws.id, "proj-1").project.id).toBe("proj-1");
  });

  it("editor can create/save but not delete", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, tokenA, ws.id, {
      projectId: "proj-1",
      project: projectFor("proj-1"),
    });
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    const created = handleCreateWorkspaceProject(state, tokenB, ws.id, {
      projectId: "proj-2",
      project: projectFor("proj-2"),
    });
    expect(created.projectId).toBe("proj-2");
    expectCode(() => handleDeleteWorkspaceProject(state, tokenB, ws.id, "proj-1"), "PERMISSION_DENIED");
  });

  it("non-members cannot list or read workspace projects (no cross-workspace enumeration)", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsA = createWorkspace(tokenA, "Team A");
    const wsB = createWorkspace(tokenB, "Team B");
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, tokenA, wsA.id, {
      projectId: "proj-1",
      project: projectFor("proj-1"),
    });
    handleCreateWorkspaceProject(state, tokenB, wsB.id, {
      projectId: "proj-2",
      project: projectFor("proj-2"),
    });
    expectCode(() => handleListWorkspaceProjects(state, tokenB, wsA.id), "PERMISSION_DENIED");
    expectCode(() => handleFetchWorkspaceProject(state, tokenB, wsA.id, "proj-1"), "PERMISSION_DENIED");
    expect(handleListWorkspaceProjects(state, tokenB, wsB.id)).toHaveLength(1);
  });

  it("duplicate creates a fresh server identity with revision 1 (parity with Supabase RPC)", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, token, ws.id, {
      projectId: "proj-1",
      project: projectFor("proj-1"),
    });
    const copy = handleDuplicateWorkspaceProject(state, token, ws.id, "proj-1", {
      newProjectId: "proj-copy",
    });
    expect(copy.projectId).toBe("proj-copy");
    expect(copy.revision).toBe(1);
    expect(copy.name).toBe("SaaS Landing Page Copy");
    // The server-side identity is fresh; the payload is copied as-is (same as
    // the Supabase duplicate_workspace_project RPC, which copies v_source.payload).
    const full = handleFetchWorkspaceProject(state, token, ws.id, "proj-copy");
    expect(full.workspaceId).toBe(ws.id);
    expect(full.project.name).toBe("SaaS Landing Page"); // payload untouched
    // The copy has no edit lease (leases are never copied).
    expect(handleGetEditLease(state, token, ws.id, "proj-copy")).toBeNull();
  });

  it("rejects oversized payloads (schema-valid but beyond the byte cap)", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const state = getMockWorkspaceState();
    const big = projectFor("proj-1");
    // A huge (but schema-valid) props value crosses the 8 MiB serialized cap
    // while the name stays within project-name limits.
    big.pages[0].sections[0].props.bigField = "x".repeat(10 * 1024 * 1024);
    expectCode(
      () =>
        handleCreateWorkspaceProject(state, token, ws.id, {
          projectId: "proj-1",
          project: big,
        }),
      "PAYLOAD_TOO_LARGE",
    );
  });
});

describe("edit leases", () => {
  function seededProject(token: string, wsId: string, projectId = "proj-1"): string {
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, token, wsId, {
      projectId,
      project: projectFor(projectId),
    });
    return projectId;
  }

  it("acquires a lease, heartbeats it, and releases it", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const projectId = seededProject(token, ws.id);
    const state = getMockWorkspaceState();
    const acquired = handleAcquireEditLease(state, token, ws.id, projectId);
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const lease = acquired.lease;
    expect(lease.leaseId).toMatch(/^lease-/);
    expect(lease.userId).toBeTruthy();
    // Heartbeat renews.
    const beat = handleHeartbeatEditLease(state, token, lease.leaseId);
    expect(beat.expiresAt > lease.expiresAt || beat.heartbeatAt >= lease.heartbeatAt).toBe(true);
    // Release clears it.
    handleReleaseEditLease(state, token, lease.leaseId);
    expect(handleGetEditLease(state, token, ws.id, projectId)).toBeNull();
  });

  it("a second editor is blocked while the lease is active", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const projectId = seededProject(tokenA, ws.id);
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    const acquired = handleAcquireEditLease(state, tokenA, ws.id, projectId);
    expect(acquired.ok).toBe(true);
    const blocked = handleAcquireEditLease(state, tokenB, ws.id, projectId);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("LEASE_HELD");
    expect(blocked.lease.holderEmail).toBe("a@example.com");
  });

  it("stale leases are recoverable (expired lease is replaceable)", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const projectId = seededProject(tokenA, ws.id);
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    const acquired = handleAcquireEditLease(state, tokenA, ws.id, projectId);
    if (!acquired.ok) return;
    // Force-expire the lease server-side.
    const lease = [...state.leases.values()].find(
      (l) => l.workspaceId === ws.id && l.projectId === projectId,
    )!;
    lease.expiresAt = new Date(Date.now() - 1000).toISOString();
    const taken = handleAcquireEditLease(state, tokenB, ws.id, projectId);
    expect(taken.ok).toBe(true);
    if (taken.ok) expect(taken.lease.userId).not.toBe(tokenA);
  });

  it("renewing your own lease is allowed while active", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const projectId = seededProject(token, ws.id);
    const state = getMockWorkspaceState();
    const first = handleAcquireEditLease(state, token, ws.id, projectId);
    if (!first.ok) return;
    const renew = handleAcquireEditLease(state, token, ws.id, projectId);
    expect(renew.ok).toBe(true);
  });

  it("heartbeat with a forged/foreign lease id is rejected", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const projectId = seededProject(tokenA, ws.id);
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    const acquired = handleAcquireEditLease(state, tokenA, ws.id, projectId);
    if (!acquired.ok) return;
    expectCode(
      () => handleHeartbeatEditLease(state, tokenB, acquired.lease.leaseId),
      "LEASE_INVALID",
    );
    expectCode(
      () => handleReleaseEditLease(state, tokenB, acquired.lease.leaseId),
      "LEASE_INVALID",
    );
  });

  it("viewer cannot acquire a lease; non-members cannot see leases", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const tokenC = signUp("c@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const projectId = seededProject(tokenA, ws.id);
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "viewer" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    expectCode(
      () => handleAcquireEditLease(state, tokenB, ws.id, projectId),
      "PERMISSION_DENIED",
    );
    expectCode(() => handleGetEditLease(state, tokenC, ws.id, projectId), "PERMISSION_DENIED");
  });

  it("member removal immediately invalidates the member's lease", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const projectId = seededProject(tokenA, ws.id);
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    const acquired = handleAcquireEditLease(state, tokenB, ws.id, projectId);
    expect(acquired.ok).toBe(true);
    const members = handleListMembers(state, tokenA, ws.id);
    handleRemoveMember(state, tokenA, ws.id, members[0].userId);
    // Lease is gone; b's heartbeat is rejected.
    expect(handleGetEditLease(state, tokenA, ws.id, projectId)).toBeNull();
    if (acquired.ok) {
      expectCode(() => handleHeartbeatEditLease(state, tokenB, acquired.lease.leaseId), "LEASE_INVALID");
    }
  });

  it("role downgrade to viewer invalidates the member's lease and saves", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const ws = createWorkspace(tokenA);
    const state = getMockWorkspaceState();
    const projectId = seededProject(tokenA, ws.id);
    handleInviteMember(state, tokenA, ws.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    const acquired = handleAcquireEditLease(state, tokenB, ws.id, projectId);
    expect(acquired.ok).toBe(true);
    const members = handleListMembers(state, tokenA, ws.id);
    handleChangeMemberRole(state, tokenA, ws.id, members[0].userId, "viewer");
    // Downgrade removes the lease.
    expect(handleGetEditLease(state, tokenA, ws.id, projectId)).toBeNull();
    // b's heartbeat and saves are now rejected.
    if (acquired.ok) {
      expectCode(() => handleHeartbeatEditLease(state, tokenB, acquired.lease.leaseId), "LEASE_INVALID");
    }
    expectCode(
      () =>
        handleSaveWorkspaceProject(state, tokenB, {
          workspaceId: ws.id,
          projectId,
          project: projectFor(projectId),
          expectedRevision: 1,
        }),
      "PERMISSION_DENIED",
    );
  });

  it("leases are isolated per project and per workspace", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const state = getMockWorkspaceState();
    const p1 = seededProject(token, ws.id, "proj-1");
    const p2 = seededProject(token, ws.id, "proj-2");
    const a1 = handleAcquireEditLease(state, token, ws.id, p1);
    const a2 = handleAcquireEditLease(state, token, ws.id, p2);
    expect(a1.ok).toBe(true);
    expect(a2.ok).toBe(true);
    if (a1.ok && a2.ok) {
      expect(a1.lease.leaseId).not.toBe(a2.lease.leaseId);
    }
  });

  it("revoking leases for a project only touches workspaces the caller belongs to", () => {
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsA = createWorkspace(tokenA, "Team A");
    const wsB = createWorkspace(tokenB, "Team B");
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, tokenA, wsA.id, {
      projectId: "proj-shared",
      project: projectFor("proj-shared"),
    });
    handleCreateWorkspaceProject(state, tokenB, wsB.id, {
      projectId: "proj-shared",
      project: projectFor("proj-shared"),
    });
    const inA = handleAcquireEditLease(state, tokenA, wsA.id, "proj-shared");
    const inB = handleAcquireEditLease(state, tokenB, wsB.id, "proj-shared");
    expect(inA.ok && inB.ok).toBe(true);
    if (!inA.ok || !inB.ok) return;
    // A revokes leases for the shared id: only A's lease goes, B's is skipped
    // (A is not a member of B's workspace) — no throw, no cross-workspace touch.
    handleRevokeLeasesForProject(state, tokenA, "proj-shared");
    expect(handleGetEditLease(state, tokenA, wsA.id, "proj-shared")).toBeNull();
    expect(handleGetEditLease(state, tokenB, wsB.id, "proj-shared")).not.toBeNull();
  });

  it("same project id in two workspaces has fully independent leases", () => {
    // A project_id is only unique WITHIN a workspace; the same id in another
    // workspace must never block, release, or be released by the first.
    const tokenA = signUp("a@example.com");
    const tokenB = signUp("b@example.com");
    const wsA = createWorkspace(tokenA, "Team A");
    const wsB = createWorkspace(tokenB, "Team B");
    const state = getMockWorkspaceState();
    // Both workspaces hold a project with the SAME project id.
    handleCreateWorkspaceProject(state, tokenA, wsA.id, {
      projectId: "proj-shared",
      project: projectFor("proj-shared"),
    });
    handleCreateWorkspaceProject(state, tokenB, wsB.id, {
      projectId: "proj-shared",
      project: projectFor("proj-shared"),
    });
    // Acquiring in A does NOT block B (no cross-workspace LEASE_HELD).
    const inA = handleAcquireEditLease(state, tokenA, wsA.id, "proj-shared");
    const inB = handleAcquireEditLease(state, tokenB, wsB.id, "proj-shared");
    expect(inA.ok).toBe(true);
    expect(inB.ok).toBe(true);
    if (!inA.ok || !inB.ok) return;
    expect(inA.lease.leaseId).not.toBe(inB.lease.leaseId);
    // Releasing A's lease leaves B's untouched.
    handleReleaseEditLease(state, tokenA, inA.lease.leaseId);
    expect(handleGetEditLease(state, tokenB, wsB.id, "proj-shared")).not.toBeNull();
    // Deleting the project in A must not delete B's lease.
    handleDeleteWorkspaceProject(state, tokenA, wsA.id, "proj-shared");
    expect(handleGetEditLease(state, tokenB, wsB.id, "proj-shared")).not.toBeNull();
  });

  it("workspace deletion cascades projects and leases", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const state = getMockWorkspaceState();
    const projectId = seededProject(token, ws.id);
    handleAcquireEditLease(state, token, ws.id, projectId);
    handleDeleteWorkspace(state, token, ws.id);
    expect(handleListWorkspaces(state, token).owned).toHaveLength(0);
    // Workspace is gone → its projects are unreachable.
    expectCode(
      () => handleFetchWorkspaceProject(state, token, ws.id, projectId),
      "NOT_FOUND",
    );
  });

  it("workspace deletion cascades collaboration rooms and send-rate state (Phase P21 F5)", () => {
    const token = signUp("a@example.com");
    const ws = createWorkspace(token);
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, token, ws.id, {
      projectId: "proj-1",
      project: projectFor("proj-1"),
    });
    // Join + send to materialize the room and its send-rate bucket.
    handleCollabJoin(state, token, ws.id, "proj-1");
    handleCollabSend(state, token, ws.id, "proj-1", {
      update: "aGVsbG8=", // valid base64 Yjs update
      actorClientId: "client-a",
    });
    expect(state.collabRooms.size).toBe(1);
    expect(state.collabSendAttempts.size).toBe(1);

    handleDeleteWorkspace(state, token, ws.id);

    // No leaked room / send-rate state for the deleted workspace.
    expect(state.collabRooms.size).toBe(0);
    expect(state.collabSendAttempts.size).toBe(0);
  });
});

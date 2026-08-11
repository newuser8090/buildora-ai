// ---------------------------------------------------------------------------
// Phase P15 — presence unit tests (mock backend)
//
// Covers the ephemeral presence model: join/heartbeat/leave, server-authoritative
// TTL expiry, lease-derived viewing/editing mode, workspace scoping, member-only
// access, removed-member rejection, session-id forgery, and bounded sessions.
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
  handleInviteMember,
  handleAcceptInvitation,
  handleCreateWorkspaceProject,
  handleJoinPresence,
  handleHeartbeatPresence,
  handleLeavePresence,
  handleListWorkspacePresence,
  handleRemoveMember,
  handleChangeMemberRole,
  purgeUserPresence,
} from "../mock/mock-workspace-server";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { Workspace } from "../types";

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
  return handleCreateWorkspace(getMockWorkspaceState(), token, { name });
}

function projectFor(id: string) {
  return JSON.parse(JSON.stringify({ ...MOCK_PROJECT, id }));
}

/** Sign up + workspace + a project (revision 1) for a member. */
function setupMemberWorkspace(): {
  tokenA: string;
  tokenB: string;
  workspace: Workspace;
  projectId: string;
} {
  const tokenA = signUp("a@example.com");
  const tokenB = signUp("b@example.com");
  const workspace = createWorkspace(tokenA);
  const state = getMockWorkspaceState();
  handleInviteMember(state, tokenA, workspace.id, { email: "b@example.com", role: "editor" });
  handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
  const project = handleCreateWorkspaceProject(state, tokenA, workspace.id, {
    projectId: "proj-1",
    project: projectFor("proj-1"),
  });
  return { tokenA, tokenB, workspace, projectId: project.projectId };
}

beforeEach(() => {
  resetMockCloudState();
  resetMockWorkspaceState();
  getMockWorkspaceState();
});

describe("presence — join/heartbeat/leave", () => {
  it("joins a workspace and appears in the presence list", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      projectId: "proj-1",
      sessionId: "pres-session-1",
    });
    const list = handleListWorkspacePresence(state, tokenA, workspace.id, "proj-1");
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe("pres-session-1");
    expect(list[0].userId).toBe(state.workspaces.get(workspace.id)!.ownerId);
    // Phase P16 — mode is role-derived: the owner with an active project
    // session reports "editing" (no lease is needed for ordinary editing).
    expect(list[0].mode).toBe("editing");
  });

  it("heartbeat refreshes the TTL (server clock)", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      sessionId: "pres-session-1",
    });
    handleHeartbeatPresence(state, tokenA, "pres-session-1");
    const list = handleListWorkspacePresence(state, tokenA, workspace.id);
    expect(list[0].sessionId).toBe("pres-session-1");
  });

  it("leave is idempotent and removes the session", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      sessionId: "pres-session-1",
    });
    handleLeavePresence(state, tokenA, "pres-session-1");
    handleLeavePresence(state, tokenA, "pres-session-1"); // idempotent
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(0);
  });

  it("expired sessions disappear without client action", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      sessionId: "pres-session-1",
    });
    // Backdate the session past the TTL, then read (reads prune).
    const session = state.presence.get("pres-session-1")!;
    session.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(0);
  });

  it("rejects a foreign session id (no hijacking another user's slot)", () => {
    const { tokenA, tokenB, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      sessionId: "pres-session-1",
    });
    expectCode(
      () =>
        handleJoinPresence(state, tokenB, {
          workspaceId: workspace.id,
          sessionId: "pres-session-1",
        }),
      "PERMISSION_DENIED",
    );
  });
});

describe("presence — viewing vs editing (role-derived)", () => {
  it("an owner with an active project session reports editing (no lease needed)", () => {
    const { tokenA, workspace, projectId } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    // Phase P16 — no exclusive lease is acquired for ordinary editing.
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      sessionId: "pres-session-1",
    });
    const list = handleListWorkspacePresence(state, tokenA, workspace.id, projectId);
    expect(list[0].mode).toBe("editing");
  });

  it("two editors in the same project both report editing (simultaneous)", () => {
    const { tokenA, tokenB, workspace, projectId } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    // A (owner) and B (editor) are both in the project — P16 simultaneous
    // editing means BOTH report "editing", never a lease-blocked "viewing".
    handleJoinPresence(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      sessionId: "pres-session-a",
    });
    handleJoinPresence(state, tokenB, {
      workspaceId: workspace.id,
      projectId,
      sessionId: "pres-session-b",
    });
    const list = handleListWorkspacePresence(state, tokenB, workspace.id, projectId);
    expect(list.find((p) => p.sessionId === "pres-session-a")!.mode).toBe("editing");
    expect(list.find((p) => p.sessionId === "pres-session-b")!.mode).toBe("editing");
  });

  it("a viewer reports viewing (never claims editing)", () => {
    const { tokenA, tokenB, workspace, projectId } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    // Downgrade B to viewer; B's presence re-joins as viewing.
    const bUserId = getMockCloudState().sessions.get(tokenB)!;
    handleChangeMemberRole(state, tokenA, workspace.id, bUserId, "viewer");
    handleJoinPresence(state, tokenB, {
      workspaceId: workspace.id,
      projectId,
      sessionId: "pres-session-b",
    });
    const list = handleListWorkspacePresence(state, tokenB, workspace.id, projectId);
    expect(list.find((p) => p.sessionId === "pres-session-b")!.mode).toBe("viewing");
  });
});

describe("presence — workspace scoping + membership", () => {
  it("presence is never shared across workspaces", () => {
    const tokenA = signUp("a@example.com");
    const ws1 = createWorkspace(tokenA, "Team 1");
    const ws2 = createWorkspace(tokenA, "Team 2");
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, { workspaceId: ws1.id, sessionId: "pres-s1" });
    expect(handleListWorkspacePresence(state, tokenA, ws1.id)).toHaveLength(1);
    expect(handleListWorkspacePresence(state, tokenA, ws2.id)).toHaveLength(0);
  });

  it("non-members cannot join or read presence", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const outsider = signUp("outsider@example.com");
    const state = getMockWorkspaceState();
    expectCode(
      () =>
        handleJoinPresence(state, outsider, {
          workspaceId: workspace.id,
          sessionId: "pres-s1",
        }),
      "PERMISSION_DENIED",
    );
    expectCode(
      () => handleListWorkspacePresence(state, outsider, workspace.id),
      "PERMISSION_DENIED",
    );
    // A is still present (outsider's failed join left no trace).
    handleJoinPresence(state, tokenA, { workspaceId: workspace.id, sessionId: "pres-a" });
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(1);
  });

  it("removed members lose their presence sessions immediately", () => {
    const { tokenA, tokenB, workspace, projectId } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    const cloud = getMockCloudState();
    handleJoinPresence(state, tokenB, {
      workspaceId: workspace.id,
      projectId,
      sessionId: "pres-b",
    });
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(1);
    // Remove by B's real user id (resolved from the cloud session).
    const bUserId = cloud.sessions.get(tokenB)!;
    handleRemoveMember(state, tokenA, workspace.id, bUserId);
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(0);
  });

  it("downgrade to viewer ends the member's editing presence", () => {
    const { tokenA, tokenB, workspace, projectId } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenB, {
      workspaceId: workspace.id,
      projectId,
      sessionId: "pres-b",
    });
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(1);
    const bUserId = getMockCloudState().sessions.get(tokenB)!;
    handleChangeMemberRole(state, tokenA, workspace.id, bUserId, "viewer");
    // Downgrade invalidates the editor's live editing presence (server-purged;
    // a re-join as viewer would report "viewing").
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(0);
  });

  it("purgeUserPresence removes every session for a user/workspace", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, { workspaceId: workspace.id, sessionId: "pres-a1" });
    handleJoinPresence(state, tokenA, { workspaceId: workspace.id, sessionId: "pres-a2" });
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(2);
    purgeUserPresence(state, workspace.id, getMockCloudState().sessions.get(tokenA)!);
    expect(handleListWorkspacePresence(state, tokenA, workspace.id)).toHaveLength(0);
  });
});

describe("presence — abuse bounds", () => {
  it("bounded session count per user per workspace", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    for (let i = 0; i < 8; i += 1) {
      handleJoinPresence(state, tokenA, {
        workspaceId: workspace.id,
        sessionId: `pres-s${i}`,
      });
    }
    expectCode(
      () =>
        handleJoinPresence(state, tokenA, {
          workspaceId: workspace.id,
          sessionId: "pres-extra",
        }),
      "RATE_LIMITED",
    );
  });

  it("rejects malformed session ids", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    expectCode(
      () =>
        handleJoinPresence(state, tokenA, {
          workspaceId: workspace.id,
          sessionId: "",
        }),
      "INVALID_INPUT",
    );
    expectCode(
      () =>
        handleJoinPresence(state, tokenA, {
          workspaceId: workspace.id,
          sessionId: "x".repeat(201),
        }),
      "INVALID_INPUT",
    );
  });

  it("presence payload is fixed-shape (no arbitrary JSON passthrough)", () => {
    const { tokenA, workspace } = setupMemberWorkspace();
    const state = getMockWorkspaceState();
    handleJoinPresence(state, tokenA, { workspaceId: workspace.id, sessionId: "pres-s1" });
    const list = handleListWorkspacePresence(state, tokenA, workspace.id);
    expect(Object.keys(list[0]).sort()).toEqual(
      ["displayName", "joinedAt", "lastSeenAt", "mode", "projectId", "sessionId", "userId", "workspaceId"].sort(),
    );
  });
});

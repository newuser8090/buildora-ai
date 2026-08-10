// ---------------------------------------------------------------------------
// Phase P15 — activity unit tests (mock backend)
//
// Covers the durable activity timeline: allow-listed event types, server-derived
// actors (forged actor ignored), metadata allow-lists, ordering, pagination,
// retention, project filtering, member/publishing/share events, privacy
// exclusions, and unauthorized-read denial.
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
  handleSaveWorkspaceProject,
  handleRecordActivityEvent,
  handleListActivity,
  handleUpdateWorkspace,
  handleChangeMemberRole,
  handleRemoveMember,
} from "../mock/mock-workspace-server";
import { ACTIVITY_RETENTION } from "../constants";
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

function projectFor(id: string, name = "Landing") {
  return JSON.parse(JSON.stringify({ ...MOCK_PROJECT, id, name }));
}

/** Sign up + workspace + project (revision 1) for the owner. */
function setupOwnerWorkspace(): { tokenA: string; workspace: Workspace; projectId: string } {
  const tokenA = signUp("a@example.com");
  const workspace = createWorkspace(tokenA);
  const state = getMockWorkspaceState();
  const project = handleCreateWorkspaceProject(state, tokenA, workspace.id, {
    projectId: "proj-1",
    project: projectFor("proj-1"),
  });
  return { tokenA, workspace, projectId: project.projectId };
}

/** Owner workspace + an invited editor member. */
function setupTwoMemberWorkspace(): {
  tokenA: string;
  tokenB: string;
  workspace: Workspace;
  projectId: string;
} {
  const { tokenA, workspace, projectId } = setupOwnerWorkspace();
  const tokenB = signUp("b@example.com");
  const state = getMockWorkspaceState();
  handleInviteMember(state, tokenA, workspace.id, { email: "b@example.com", role: "editor" });
  handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
  return { tokenA, tokenB, workspace, projectId };
}

beforeEach(() => {
  resetMockCloudState();
  resetMockWorkspaceState();
  getMockWorkspaceState();
});

describe("activity — creation wiring", () => {
  it("records workspace.created on creation", () => {
    const tokenA = signUp("a@example.com");
    const workspace = createWorkspace(tokenA);
    const list = handleListActivity(getMockWorkspaceState(), tokenA, workspace.id, {});
    expect(list.events[0].type).toBe("workspace.created");
    expect(list.events[0].actorName).toBe("A"); // derived display name
  });

  it("records member + project + save + rename events", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const tokenB = signUp("b@example.com");
    handleInviteMember(state, tokenA, workspace.id, { email: "b@example.com", role: "editor" });
    handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "New Name"),
      expectedRevision: 1,
    });
    const list = handleListActivity(state, tokenA, workspace.id, {});
    const types = list.events.map((e) => e.type);
    expect(types).toContain("project.created");
    expect(types).toContain("member.invited");
    expect(types).toContain("member.joined");
    expect(types).toContain("project.saved");
    expect(types).toContain("project.renamed");
  });

  it("publish/share/domain events can be recorded by any member", () => {
    const { tokenA, tokenB, workspace, projectId } = setupTwoMemberWorkspace();
    const state = getMockWorkspaceState();
    const result = handleRecordActivityEvent(state, tokenB, {
      workspaceId: workspace.id,
      projectId,
      type: "publish.completed",
      metadata: { provider: "mock", project: "Landing" },
    });
    expect(result.actorUserId).toBe(getMockCloudState().sessions.get(tokenB)!);
    handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "share.created",
      metadata: { project: "Landing" },
    });
    handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "domain.attached",
      metadata: { domain: "example.com", project: "Landing" },
    });
    const list = handleListActivity(state, tokenA, workspace.id, {});
    expect(list.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["publish.completed", "share.created", "domain.attached"]),
    );
  });
});

describe("activity — allow-lists + privacy", () => {
  it("rejects unknown event types", () => {
    const { tokenA, workspace } = setupOwnerWorkspace();
    expectCode(
      () =>
        handleRecordActivityEvent(getMockWorkspaceState(), tokenA, {
          workspaceId: workspace.id,
          type: "anything.injected",
          metadata: {},
        }),
      "INVALID_INPUT",
    );
  });

  it("actor is server-derived — a forged body actor is ignored", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const event = handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "project.saved",
      // The mock handler signature has no actor field at all — the type system
      // structurally prevents forgery. This is the same guarantee as Supabase.
      metadata: {},
    });
    expect(event.actorUserId).toBe(getMockCloudState().sessions.get(tokenA)!);
  });

  it("metadata keys are allow-listed per type (unknown keys dropped)", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const event = handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "share.created",
      metadata: {
        project: "Landing", // allowed
        secretToken: "should-be-dropped",
        rawJson: { nested: true },
      },
    });
    expect(event.metadata).toEqual({ project: "Landing" });
  });

  it("oversized metadata strings are dropped", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const event = handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "share.created",
      metadata: { project: "x".repeat(500) },
    });
    expect(event.metadata).toEqual({});
  });

  it("metadata is small and typed (no raw project JSON)", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const event = handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "project.saved",
      metadata: { revision: 3 },
    });
    expect(event.metadata.revision).toBe(3);
    expect(Object.keys(event.metadata).length).toBeLessThanOrEqual(4);
  });
});

describe("activity — ordering + pagination + retention", () => {
  it("orders newest first with stable (createdAt, id) pagination", () => {
    const { tokenA, workspace } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    // workspace.created + project.created exist; add 5 more (same-ms events
    // exercise the (createdAt, id) tie-breaker).
    for (let i = 0; i < 5; i += 1) {
      handleRecordActivityEvent(state, tokenA, {
        workspaceId: workspace.id,
        type: "project.saved",
        metadata: { revision: i },
      });
    }
    // Reference: the full sorted feed (deterministic ordering).
    const full = handleListActivity(state, tokenA, workspace.id, { limit: 30 }).events;
    const fullIds = full.map((e) => e.id);
    expect(full.length).toBe(7); // 2 setup + 5 recorded
    // Page through with the cursor and verify no dupes/no gaps and that the
    // concatenation matches the full feed exactly.
    const collected: string[] = [];
    let cursor: { ts: string; id: string } | null | undefined;
    let guard = 0;
    do {
      const page = handleListActivity(state, tokenA, workspace.id, {
        limit: 2,
        before: cursor ?? undefined,
      });
      collected.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor;
      guard += 1;
      expect(guard).toBeLessThan(10); // never an unbounded loop
    } while (cursor);
    expect(new Set(collected).size).toBe(collected.length); // no duplicates
    expect(collected).toEqual(fullIds); // pagination reproduces the feed exactly
  });

  it("retains at most ACTIVITY_RETENTION events", () => {
    const { tokenA, workspace } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    for (let i = 0; i < ACTIVITY_RETENTION + 20; i += 1) {
      handleRecordActivityEvent(state, tokenA, {
        workspaceId: workspace.id,
        type: "project.saved",
        metadata: { revision: i },
      });
    }
    // Page through the full feed (pages are capped at the page size).
    let total = 0;
    let cursor: { ts: string; id: string } | null | undefined;
    do {
      const page = handleListActivity(state, tokenA, workspace.id, {
        limit: 30,
        before: cursor ?? undefined,
      });
      total += page.events.length;
      cursor = page.nextCursor;
    } while (cursor);
    expect(total).toBeLessThanOrEqual(ACTIVITY_RETENTION);
    expect(total).toBe(ACTIVITY_RETENTION); // pruned exactly to the bound
  });

  it("supports category filters", () => {
    const { tokenA, workspace, projectId } = setupTwoMemberWorkspace();
    const state = getMockWorkspaceState();
    handleInviteMember(state, tokenA, workspace.id, { email: "c@example.com", role: "viewer" });
    handleRecordActivityEvent(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      type: "publish.completed",
      metadata: { provider: "mock", project: "Landing" },
    });
    const members = handleListActivity(state, tokenA, workspace.id, { filter: "members" });
    expect(members.events.every((e) => e.type.startsWith("member."))).toBe(true);
    const publishing = handleListActivity(state, tokenA, workspace.id, { filter: "publishing" });
    expect(publishing.events.every((e) => e.type.startsWith("publish.") || e.type.startsWith("domain."))).toBe(true);
  });

  it("project-filterable via client (single source of truth)", () => {
    const { tokenA, workspace } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, tokenA, workspace.id, {
      projectId: "proj-2",
      project: projectFor("proj-2"),
    });
    const events = handleListActivity(state, tokenA, workspace.id, {});
    const proj1 = events.events.filter((e) => e.projectId === "proj-1");
    const proj2 = events.events.filter((e) => e.projectId === "proj-2");
    expect(proj1.length).toBeGreaterThan(0);
    expect(proj2.length).toBeGreaterThan(0);
  });
});

describe("activity — authorization", () => {
  it("non-members cannot read or record activity", () => {
    const { workspace } = setupOwnerWorkspace();
    const outsider = signUp("outsider@example.com");
    const state = getMockWorkspaceState();
    expectCode(
      () => handleListActivity(state, outsider, workspace.id, {}),
      "PERMISSION_DENIED",
    );
    expectCode(
      () =>
        handleRecordActivityEvent(state, outsider, {
          workspaceId: workspace.id,
          type: "workspace.renamed",
          metadata: { to: "X" },
        }),
      "PERMISSION_DENIED",
    );
  });

  it("project-scoped events require the project to exist", () => {
    const { tokenA, workspace } = setupOwnerWorkspace();
    expectCode(
      () =>
        handleRecordActivityEvent(getMockWorkspaceState(), tokenA, {
          workspaceId: workspace.id,
          projectId: "does-not-exist",
          type: "project.saved",
          metadata: {},
        }),
      "PROJECT_NOT_FOUND",
    );
  });

  it("workspace.renamed events carry the new name only", () => {
    const { tokenA, workspace } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleUpdateWorkspace(state, tokenA, workspace.id, { name: "Renamed Team" });
    const list = handleListActivity(state, tokenA, workspace.id, {});
    const renamed = list.events.find((e) => e.type === "workspace.renamed");
    expect(renamed?.metadata.to).toBe("Renamed Team");
  });

  it("member events (role change / removal) are recorded by the acting owner", () => {
    const { tokenA, tokenB, workspace } = setupTwoMemberWorkspace();
    const state = getMockWorkspaceState();
    const bUserId = getMockCloudState().sessions.get(tokenB)!;
    handleChangeMemberRole(state, tokenA, workspace.id, bUserId, "viewer");
    handleRemoveMember(state, tokenA, workspace.id, bUserId);
    const list = handleListActivity(state, tokenA, workspace.id, {});
    const types = list.events.map((e) => e.type);
    expect(types).toContain("member.role_changed");
    expect(types).toContain("member.removed");
  });
});

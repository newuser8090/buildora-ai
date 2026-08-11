// ---------------------------------------------------------------------------
// Phase P16 — collab room unit tests (mock backend)
//
// Covers the collaboration ROOM contract the transports depend on:
//   * join returns the durable base + frontier + canonical state
//   * seed: first-writer-wins, editor/owner only, size-capped
//   * send: editor/owner only, viewers/removed rejected, size-capped,
//     maintenance lock pauses writes, bounded log
//   * poll: catch-up after a frontier, rebase when behind the pruned frontier
//   * checkpoint: prunes the log + refreshes canonical state (bounded)
//   * lock/unlock: owner-only maintenance lock
//   * restore: resets the room (incl. canonical state) so late joiners rebase
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
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
  handleDeleteWorkspaceProject,
  handleRestoreProjectVersion,
  handleCreateManualVersion,
  handleAcquireEditLease,
  handleCollabJoin,
  handleCollabSeed,
  handleCollabSend,
  handleCollabPoll,
  handleCollabCheckpoint,
  handleCollabLock,
  handleCollabUnlock,
  handleListProjectVersions,
} from "@/features/workspaces/mock/mock-workspace-server";
import { arrayToBase64 } from "../transport/mock-http-collab-transport";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { Workspace } from "@/features/workspaces/types";

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

function projectFor(id: string, name = "Landing", heading = "Original") {
  return JSON.parse(
    JSON.stringify({
      ...MOCK_PROJECT,
      id,
      name,
      pages: [{ ...MOCK_PROJECT.pages[0], title: heading }],
    }),
  );
}

/** A small valid Yjs update (base64) for transport-level tests. */
function tinyUpdate(): string {
  const doc = new Y.Doc();
  doc.getText("x").insert(0, "hi");
  return arrayToBase64(Y.encodeStateAsUpdate(doc));
}

/** Build a room with an owner, an editor member, and a viewer member. */
function setupRoom(): {
  tokenOwner: string;
  tokenEditor: string;
  tokenViewer: string;
  tokenStranger: string;
  workspace: Workspace;
  projectId: string;
} {
  const tokenOwner = signUp("owner@example.com");
  const workspace = createWorkspace(tokenOwner);
  const state = getMockWorkspaceState();

  // Editor member.
  const tokenEditor = signUp("editor@example.com");
  handleInviteMember(state, tokenOwner, workspace.id, { email: "editor@example.com", role: "editor" });
  const inviteEditor = [...state.invitations.values()].find(
    (i) => i.recipientEmail === "editor@example.com",
  );
  handleAcceptInvitation(state, tokenEditor, inviteEditor!.id);

  // Viewer member.
  const tokenViewer = signUp("viewer@example.com");
  handleInviteMember(state, tokenOwner, workspace.id, { email: "viewer@example.com", role: "viewer" });
  const inviteViewer = [...state.invitations.values()].find(
    (i) => i.recipientEmail === "viewer@example.com",
  );
  handleAcceptInvitation(state, tokenViewer, inviteViewer!.id);

  const tokenStranger = signUp("stranger@example.com");
  const project = handleCreateWorkspaceProject(state, tokenOwner, workspace.id, {
    projectId: "proj-1",
    project: projectFor("proj-1"),
  });
  return { tokenOwner, tokenEditor, tokenViewer, tokenStranger, workspace, projectId: project.projectId };
}

beforeEach(() => {
  resetMockCloudState();
  resetMockWorkspaceState();
});

// ---------------------------------------------------------------------------
// Join & canonical state
// ---------------------------------------------------------------------------

describe("collab room join", () => {
  it("returns the durable base + frontier + no canonical state when fresh", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    const joined = handleCollabJoin(state, tokenEditor, workspace.id, projectId);
    expect(joined.seq).toBe(0);
    expect(joined.checkpointSeq).toBe(0);
    expect(joined.base).toBeDefined();
    expect((joined.base as { id: string }).id).toBe("proj-1");
    expect(joined.state).toBeUndefined();
  });

  it("rejects non-members (cross-workspace / stranger)", () => {
    const { tokenStranger, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    expectCode(
      () => handleCollabJoin(state, tokenStranger, workspace.id, projectId),
      "PERMISSION_DENIED",
    );
  });

  it("returns the canonical state once seeded", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabSeed(state, tokenEditor, workspace.id, projectId, { state: tinyUpdate() });
    const joined = handleCollabJoin(state, tokenEditor, workspace.id, projectId);
    expect(joined.state).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Seed — first writer wins, editor/owner only, bounded
// ---------------------------------------------------------------------------

describe("collab seed", () => {
  it("first seed wins; a second seed receives the winner's state", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    const winner = tinyUpdate();
    const first = handleCollabSeed(state, tokenEditor, workspace.id, projectId, { state: winner });
    expect(first.state).toBeNull(); // this client won
    const loser = handleCollabSeed(state, tokenEditor, workspace.id, projectId, {
      state: arrayToBase64(Y.encodeStateAsUpdate(new Y.Doc())),
    });
    expect(loser.state).toBe(winner); // must apply the winner's state
  });

  it("viewers cannot seed (canonical state is mutation-bearing)", () => {
    const { tokenViewer, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    expectCode(
      () => handleCollabSeed(state, tokenViewer, workspace.id, projectId, { state: tinyUpdate() }),
      "PERMISSION_DENIED",
    );
  });

  it("strangers cannot seed", () => {
    const { tokenStranger, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    expectCode(
      () => handleCollabSeed(state, tokenStranger, workspace.id, projectId, { state: tinyUpdate() }),
      "PERMISSION_DENIED",
    );
  });

  it("rejects oversized canonical state", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    // Valid base64 that DECODES beyond the 256 KB cap (the cap is measured on
    // the decoded payload, parity with the Supabase octet_length(bytea) check).
    const huge = arrayToBase64(new Uint8Array(300 * 1024));
    expectCode(
      () => handleCollabSeed(state, tokenEditor, workspace.id, projectId, { state: huge }),
      "PAYLOAD_TOO_LARGE",
    );
  });
});

// ---------------------------------------------------------------------------
// Send — editor/owner only, bounded, lock-aware
// ---------------------------------------------------------------------------

describe("collab send", () => {
  it("editors can relay updates; the room seq advances", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    const result = handleCollabSend(state, tokenEditor, workspace.id, projectId, {
      update: tinyUpdate(),
      actorClientId: "client-b",
    });
    expect(result.seq).toBe(1);
    const polled = handleCollabPoll(state, tokenEditor, workspace.id, projectId, 0);
    expect(polled.rebase).toBe(false);
    expect(polled.updates).toHaveLength(1);
    expect(polled.updates[0].seq).toBe(1);
  });

  it("viewers cannot send", () => {
    const { tokenViewer, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    expectCode(
      () => handleCollabSend(state, tokenViewer, workspace.id, projectId, { update: tinyUpdate() }),
      "PERMISSION_DENIED",
    );
  });

  it("strangers cannot send", () => {
    const { tokenStranger, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    expectCode(
      () => handleCollabSend(state, tokenStranger, workspace.id, projectId, { update: tinyUpdate() }),
      "PERMISSION_DENIED",
    );
  });

  it("rejects oversized updates", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    // Valid base64 that DECODES beyond the 256 KB cap (decoded-payload cap).
    const huge = arrayToBase64(new Uint8Array(300 * 1024));
    expectCode(
      () =>
        handleCollabSend(state, tokenEditor, workspace.id, projectId, {
          update: huge,
        }),
      "PAYLOAD_TOO_LARGE",
    );
  });

  it("maintenance lock pauses other writers but not the holder", () => {
    const { tokenOwner, tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabLock(state, tokenOwner, workspace.id, projectId);
    // The lock holder can still send (restore coordination needs it).
    const result = handleCollabSend(state, tokenOwner, workspace.id, projectId, {
      update: tinyUpdate(),
    });
    expect(result.seq).toBe(1);
    // Another editor is paused.
    expectCode(
      () => handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() }),
      "LOCKED",
    );
    handleCollabUnlock(state, tokenOwner, workspace.id, projectId);
    // Writers resume after unlock.
    const after = handleCollabSend(state, tokenEditor, workspace.id, projectId, {
      update: tinyUpdate(),
    });
    expect(after.seq).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Poll — catch-up and rebase semantics
// ---------------------------------------------------------------------------

describe("collab poll", () => {
  it("catch-up returns only updates after the frontier", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() });
    handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() });
    const polled = handleCollabPoll(state, tokenEditor, workspace.id, projectId, 1);
    expect(polled.updates).toHaveLength(1);
    expect(polled.updates[0].seq).toBe(2);
  });

  it("falling behind the pruned frontier yields a rebase with the base", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() });
    handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() });
    // Checkpoint at seq 2 → frontier 2 → updates 1..2 pruned.
    handleCollabCheckpoint(state, tokenEditor, workspace.id, projectId, { seq: 2 });
    const polled = handleCollabPoll(state, tokenEditor, workspace.id, projectId, 1);
    expect(polled.rebase).toBe(true);
    expect(polled.base).toBeDefined();
    expect(polled.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint — prune + canonical refresh, bounded
// ---------------------------------------------------------------------------

describe("collab checkpoint", () => {
  it("prunes the retained log up to the frontier", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() });
    handleCollabSend(state, tokenEditor, workspace.id, projectId, { update: tinyUpdate() });
    handleCollabCheckpoint(state, tokenEditor, workspace.id, projectId, { seq: 1 });
    // A client AT the frontier (already has update 1) polls afterSeq=1: seq 1
    // is pruned, seq 2 remains.
    const polled = handleCollabPoll(state, tokenEditor, workspace.id, projectId, 1);
    expect(polled.rebase).toBe(false);
    expect(polled.updates.map((u) => u.seq)).toEqual([2]);
    // A client BEHIND the frontier (afterSeq 0 < 1) must rebase from base.
    const behind = handleCollabPoll(state, tokenEditor, workspace.id, projectId, 0);
    expect(behind.rebase).toBe(true);
  });

  it("refresh canonical state for late joiners", () => {
    const { tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    const canonical = tinyUpdate();
    handleCollabCheckpoint(state, tokenEditor, workspace.id, projectId, {
      seq: 0,
      state: canonical,
    });
    const joined = handleCollabJoin(state, tokenEditor, workspace.id, projectId);
    expect(joined.state).toBe(canonical);
  });

  it("viewers cannot checkpoint", () => {
    const { tokenViewer, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    expectCode(
      () => handleCollabCheckpoint(state, tokenViewer, workspace.id, projectId, { seq: 1 }),
      "PERMISSION_DENIED",
    );
  });
});

// ---------------------------------------------------------------------------
// Maintenance lock — owner only
// ---------------------------------------------------------------------------

describe("collab lock", () => {
  it("only owners can acquire the maintenance lock", () => {
    const { tokenOwner, tokenEditor, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabLock(state, tokenOwner, workspace.id, projectId);
    // Editors can never hold the maintenance lock.
    expectCode(
      () => handleCollabLock(state, tokenEditor, workspace.id, projectId),
      "PERMISSION_DENIED",
    );
    // The same owner re-acquiring renews (idempotent — restore coordination
    // must not fail on its own re-entry).
    expect(() => handleCollabLock(state, tokenOwner, workspace.id, projectId)).not.toThrow();
  });

  it("the same owner re-acquiring the lock renews idempotently", () => {
    const { tokenOwner, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabLock(state, tokenOwner, workspace.id, projectId);
    handleCollabLock(state, tokenOwner, workspace.id, projectId); // renew ok
    handleCollabUnlock(state, tokenOwner, workspace.id, projectId);
    const after = handleCollabLock(state, tokenOwner, workspace.id, projectId);
    expect(after).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Restore resets the room (canonical state cleared → late joiners rebase)
// ---------------------------------------------------------------------------

describe("collab restore integration", () => {
  it("restore clears the canonical state and prunes the log", () => {
    const { tokenOwner, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    // Owner holds the lease (required for manual version creation) + seeds
    // canonical state and pushes a couple of updates.
    handleAcquireEditLease(state, tokenOwner, workspace.id, projectId);
    handleCollabSeed(state, tokenOwner, workspace.id, projectId, { state: tinyUpdate() });
    handleCollabSend(state, tokenOwner, workspace.id, projectId, { update: tinyUpdate() });
    handleCollabSend(state, tokenOwner, workspace.id, projectId, { update: tinyUpdate() });
    // Create a version to restore from.
    handleCreateManualVersion(state, tokenOwner, workspace.id, projectId, "v1");
    const versions = handleListProjectVersions(state, tokenOwner, workspace.id, projectId);
    const versionId = versions[0].id;

    handleRestoreProjectVersion(state, tokenOwner, workspace.id, projectId, versionId, 1);

    const joined = handleCollabJoin(state, tokenOwner, workspace.id, projectId);
    expect(joined.state).toBeUndefined(); // canonical state cleared
    expect(joined.seq).toBe(3); // room reset (frontier bumped past pruned log)
    expect(joined.checkpointSeq).toBe(3);
    const polled = handleCollabPoll(state, tokenOwner, workspace.id, projectId, -1);
    expect(polled.updates).toHaveLength(0); // log pruned
  });

  it("restore requires owner (permission boundary preserved)", () => {
    const { tokenEditor, tokenOwner, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleAcquireEditLease(state, tokenOwner, workspace.id, projectId);
    handleCreateManualVersion(state, tokenOwner, workspace.id, projectId, "v1");
    const versions = handleListProjectVersions(state, tokenOwner, workspace.id, projectId);
    expectCode(
      () =>
        handleRestoreProjectVersion(
          state,
          tokenEditor,
          workspace.id,
          projectId,
          versions[0].id,
          1,
        ),
      "PERMISSION_DENIED",
    );
  });
});

// ---------------------------------------------------------------------------
// Project deletion cleans up the room
// ---------------------------------------------------------------------------

describe("collab room cleanup", () => {
  it("deleting the project removes the room", () => {
    const { tokenOwner, workspace, projectId } = setupRoom();
    const state = getMockWorkspaceState();
    handleCollabSeed(state, tokenOwner, workspace.id, projectId, { state: tinyUpdate() });
    handleDeleteWorkspaceProject(state, tokenOwner, workspace.id, projectId);
    // Re-joining the deleted project fails (project gone).
    expectCode(
      () => handleCollabJoin(state, tokenOwner, workspace.id, projectId),
      "PROJECT_NOT_FOUND",
    );
  });
});

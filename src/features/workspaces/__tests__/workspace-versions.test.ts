// ---------------------------------------------------------------------------
// Phase P15 — version-history unit tests (mock backend)
//
// Covers the server-backed version timeline: creation + dedupe, revision
// correctness, privacy-safe snapshots, retention, metadata-only listing, lazy
// snapshot fetch, preview, restore-as-new-revision, safety versions, stale
// restore rejection, the permission matrix, cross-workspace isolation, and
// deletion cleanup.
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
  handleListProjectVersions,
  handleFetchProjectVersion,
  handleCreateManualVersion,
  handleRestoreProjectVersion,
  handleCopyProjectFromVersion,
  handleDeleteWorkspaceProject,
  handleAcquireEditLease,
} from "../mock/mock-workspace-server";
import { VERSION_RETENTION } from "../constants";
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

function projectFor(id: string, name = "Landing", heading = "Original") {
  return JSON.parse(
    JSON.stringify({ ...MOCK_PROJECT, id, name, pages: [{ ...MOCK_PROJECT.pages[0], title: heading }] }),
  );
}

/** Owner workspace + project (revision 1). */
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

/** Owner workspace + invited editor member. */
function setupEditorWorkspace(): {
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

/** Owner workspace + invited viewer member. */
function setupViewerWorkspace(): {
  tokenA: string;
  tokenB: string;
  workspace: Workspace;
  projectId: string;
} {
  const { tokenA, workspace, projectId } = setupOwnerWorkspace();
  const tokenB = signUp("b@example.com");
  const state = getMockWorkspaceState();
  handleInviteMember(state, tokenA, workspace.id, { email: "b@example.com", role: "viewer" });
  handleAcceptInvitation(state, tokenB, [...state.invitations.values()][0].id);
  return { tokenA, tokenB, workspace, projectId };
}

beforeEach(() => {
  resetMockCloudState();
  resetMockWorkspaceState();
  getMockWorkspaceState();
});

describe("versions — creation + dedupe", () => {
  it("a changed save creates an autosave version with the correct revision", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe("autosave");
    expect(list[0].revision).toBe(2); // revision AFTER the save
    expect(list[0].contentHash).toBeTruthy();
    // Snapshot is NOT included in the metadata list.
    expect("snapshot" in list[0]).toBe(false);
    expect("project" in list[0]).toBe(false);
  });

  it("identical-content saves are silent (dedupe by content hash)", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const payload = projectFor("proj-1", "Landing", "Changed");
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: payload,
      expectedRevision: 1,
    });
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: payload,
      expectedRevision: 2,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    expect(list).toHaveLength(1); // second save deduped
  });

  it("manual checkpoints record even for identical content (explicit intent)", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    const lease = handleAcquireEditLease(state, tokenA, workspace.id, projectId);
    expect(lease.ok).toBe(true);
    // First save → v2; checkpoint the same state with a label.
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1"),
      expectedRevision: 1,
    });
    const checkpoint = handleCreateManualVersion(
      state,
      tokenA,
      workspace.id,
      projectId,
      "Before homepage redesign",
    );
    expect(checkpoint.reason).toBe("checkpoint");
    expect(checkpoint.label).toBe("Before homepage redesign");
  });

  it("manual checkpoint requires the edit lease", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    // No lease held → LEASE_HELD (mock's guarded lease message).
    expectCode(
      () => handleCreateManualVersion(state, tokenA, workspace.id, projectId, "x"),
      "LEASE_HELD",
    );
  });

  it("manual checkpoint rejects empty labels", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleAcquireEditLease(state, tokenA, workspace.id, projectId);
    expectCode(
      () => handleCreateManualVersion(state, tokenA, workspace.id, projectId, "   "),
      "INVALID_INPUT",
    );
  });
});

describe("versions — snapshot privacy", () => {
  it("snapshots are Project-shaped only (no collaboration metadata)", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const full = handleFetchProjectVersion(state, tokenA, workspace.id, projectId, list[0].id);
    const keys = Object.keys(full.project).sort();
    // Project-shaped — must not include any collaboration/runtime keys.
    for (const forbidden of ["workspaceId", "members", "invitations", "leases", "session", "copilot", "share", "tokens"]) {
      expect(keys.join(",").toLowerCase()).not.toContain(forbidden);
    }
    expect(full.project.id).toBe("proj-1");
  });

  it("fetching a version returns the full snapshot lazily", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const full = handleFetchProjectVersion(state, tokenA, workspace.id, projectId, list[0].id);
    expect(full.project.pages[0].title).toBe("Changed");
  });
});

describe("versions — restore", () => {
  it("restores an older version as a NEW revision (older versions preserved)", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed Again"),
      expectedRevision: 2,
    });
    const listBefore = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    // Restore the OLDER "Changed" autosave (v2) while current is v3.
    const target = listBefore.find((v) => v.revision === 2)!;
    const result = handleRestoreProjectVersion(state, tokenA, workspace.id, projectId, target.id, 3);
    expect(result.revision).toBe(4);
    const listAfter = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const reasons = listAfter.map((v) => v.reason);
    expect(reasons).toContain("restore");
    expect(reasons).toContain("pre-restore");
    // The restored content is the older version's snapshot, and the newer
    // versions are still in the timeline.
    const restored = listAfter.find((v) => v.reason === "restore")!;
    const restoredFull = handleFetchProjectVersion(state, tokenA, workspace.id, projectId, restored.id);
    expect(restoredFull.project.pages[0].title).toBe("Changed");
    expect(listAfter.some((v) => v.reason === "autosave" && v.revision === 3)).toBe(true);
  });

  it("stale restore (revision changed) is rejected", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const target = list[0];
    // Current revision is 2, but pass expectedRevision 1 (stale).
    expectCode(
      () => handleRestoreProjectVersion(state, tokenA, workspace.id, projectId, target.id, 1),
      "STALE_REVISION",
    );
  });

  it("restoring identical content skips the redundant pre-restore version", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    // Save once (v2 "Changed") — current content equals that autosave version.
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const newest = list[0]; // the "Changed" autosave — identical to current content
    const result = handleRestoreProjectVersion(state, tokenA, workspace.id, projectId, newest.id, 2);
    expect(result.revision).toBe(3);
    const after = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    // Content was identical → no redundant pre-restore safety version, but the
    // explicit restore version is still recorded for auditability.
    expect(after.some((v) => v.reason === "pre-restore")).toBe(false);
    expect(after.some((v) => v.reason === "restore")).toBe(true);
  });
});

describe("versions — permissions", () => {
  it("viewer can list + preview but not restore or checkpoint", () => {
    const { tokenA, tokenB, workspace, projectId } = setupViewerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenB, workspace.id, projectId);
    expect(list.length).toBeGreaterThan(0);
    expectCode(
      () => handleRestoreProjectVersion(state, tokenB, workspace.id, projectId, list[0].id, 2),
      "PERMISSION_DENIED",
    );
    expectCode(
      () => handleCreateManualVersion(state, tokenB, workspace.id, projectId, "x"),
      "PERMISSION_DENIED",
    );
  });

  it("editor can preview + copy but restore is owner-only", () => {
    const { tokenA, tokenB, workspace, projectId } = setupEditorWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenB, workspace.id, projectId);
    expectCode(
      () => handleRestoreProjectVersion(state, tokenB, workspace.id, projectId, list[0].id, 2),
      "PERMISSION_DENIED",
    );
    const copied = handleCopyProjectFromVersion(state, tokenB, workspace.id, projectId, list[0].id, {
      newProjectId: "proj-copy",
      name: "Copy",
    });
    expect(copied.projectId).toBe("proj-copy");
    expect(copied.revision).toBe(1);
  });

  it("owner restores shared state", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const result = handleRestoreProjectVersion(state, tokenA, workspace.id, projectId, list[0].id, 2);
    expect(result.revision).toBe(3);
  });

  it("non-members cannot list, preview, or restore versions", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const outsider = signUp("outsider@example.com");
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    expectCode(
      () => handleListProjectVersions(state, outsider, workspace.id, projectId),
      "PERMISSION_DENIED",
    );
    expectCode(
      () => handleFetchProjectVersion(state, outsider, workspace.id, projectId, list[0].id),
      "PERMISSION_DENIED",
    );
    expectCode(
      () => handleRestoreProjectVersion(state, outsider, workspace.id, projectId, list[0].id, 2),
      "PERMISSION_DENIED",
    );
  });
});

describe("versions — isolation + retention + cleanup", () => {
  it("versions are isolated across workspaces (same project id)", () => {
    const tokenA = signUp("a@example.com");
    const ws1 = createWorkspace(tokenA, "Team 1");
    const ws2 = createWorkspace(tokenA, "Team 2");
    const state = getMockWorkspaceState();
    handleCreateWorkspaceProject(state, tokenA, ws1.id, {
      projectId: "same-id",
      project: projectFor("same-id"),
    });
    handleCreateWorkspaceProject(state, tokenA, ws2.id, {
      projectId: "same-id",
      project: projectFor("same-id"),
    });
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: ws1.id,
      projectId: "same-id",
      project: projectFor("same-id", "Landing", "Changed in 1"),
      expectedRevision: 1,
    });
    expect(handleListProjectVersions(state, tokenA, ws1.id, "same-id")).toHaveLength(1);
    expect(handleListProjectVersions(state, tokenA, ws2.id, "same-id")).toHaveLength(0);
  });

  it("deleting a project removes its versions", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    expect(handleListProjectVersions(state, tokenA, workspace.id, projectId)).toHaveLength(1);
    handleDeleteWorkspaceProject(state, tokenA, workspace.id, projectId);
    // Versions are gone with the project.
    expectCode(
      () => handleListProjectVersions(state, tokenA, workspace.id, projectId),
      "PROJECT_NOT_FOUND",
    );
  });

  it("retains at most VERSION_RETENTION versions", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    let revision = 1;
    for (let i = 0; i < VERSION_RETENTION + 10; i += 1) {
      handleSaveWorkspaceProject(state, tokenA, {
        workspaceId: workspace.id,
        projectId,
        project: projectFor("proj-1", "Landing", `Change ${i}`),
        expectedRevision: revision,
      });
      revision += 1;
    }
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    expect(list.length).toBeLessThanOrEqual(VERSION_RETENTION);
  });

  it("copy-from-version creates a fresh project with no collaboration metadata", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const list = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    const copied = handleCopyProjectFromVersion(state, tokenA, workspace.id, projectId, list[0].id, {
      newProjectId: "ws-copy-abc",
      name: "Saved Copy",
    });
    expect(copied.name).toBe("Saved Copy");
    expect(copied.revision).toBe(1);
    expect(copied.projectId).toBe("ws-copy-abc");
    // Fresh copy has no versions of its own yet.
    expect(handleListProjectVersions(state, tokenA, workspace.id, copied.projectId)).toHaveLength(0);
  });

  it("copy rejects duplicate project ids in the workspace", () => {
    const { tokenA, workspace, projectId } = setupOwnerWorkspace();
    const state = getMockWorkspaceState();
    // No version exists yet (never saved) — create one first.
    handleSaveWorkspaceProject(state, tokenA, {
      workspaceId: workspace.id,
      projectId,
      project: projectFor("proj-1", "Landing", "Changed"),
      expectedRevision: 1,
    });
    const versions = handleListProjectVersions(state, tokenA, workspace.id, projectId);
    expectCode(
      () =>
        handleCopyProjectFromVersion(state, tokenA, workspace.id, projectId, versions[0].id, {
          newProjectId: projectId, // duplicate
          name: "Dup",
        }),
      "INVALID_INPUT",
    );
  });
});

// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — lifecycle isolation
//
//   - .buildora exports must NOT contain share tokens, comments, or review
//     auth data (sharing is service metadata outside project content)
//   - duplicating a project must NOT duplicate share access (new project is
//     unshared)
//   - deleting a project revokes/cleans its share data
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Project } from "@/types/project";
import type { ProjectPersistenceAdapter } from "@/features/persistence/types";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { ProjectExportService } from "@/features/projects/services/project-export-service";
import { ProjectService } from "@/features/projects/services/project-service";
import {
  clearShareLocalCacheForTests,
  cacheShareToken,
  cachedShareIds,
  cachedShareToken,
  setCachedShareIds,
} from "../services/share-local-cache";
import { setShareProviderForTests } from "../services/share-link-service";
import type { ShareLinkProvider } from "../providers/share-link-provider";
import {
  getMockCloudState,
  resetMockCloudState,
  handleSignup,
} from "@/features/cloud-sync/mock/mock-cloud-server";
import {
  getMockShareState,
  resetMockShareState,
  handleCreateShare,
} from "../mock/mock-share-server";

function fakeAdapter(project: Project): ProjectPersistenceAdapter {
  let stored: Project = JSON.parse(JSON.stringify(project));
  return {
    loadProject: vi.fn().mockResolvedValue({ success: true, project: stored, revision: 1 }),
    saveProject: vi.fn().mockImplementation(async (req: { project: Project; revision: number }) => {
      stored = JSON.parse(JSON.stringify(req.project));
      return { success: true };
    }),
    removeProject: vi.fn().mockResolvedValue({ success: true }),
    listProjects: vi.fn().mockResolvedValue({ success: true, projects: [] }),
    getActiveProjectId: vi.fn().mockResolvedValue({ success: true, projectId: null }),
    setActiveProjectId: vi.fn().mockResolvedValue({ success: true }),
    getDashboardMetadata: vi.fn().mockResolvedValue({ success: true, metadata: {} }),
    setDashboardMetadata: vi.fn().mockResolvedValue({ success: true }),
    removeDashboardMetadata: vi.fn().mockResolvedValue({ success: true }),
    estimateUsage: vi.fn().mockResolvedValue({ success: true, usage: 0, quota: 0 }),
    close: vi.fn(),
  } as ProjectPersistenceAdapter;
}

function shareProviderSpy(): ShareLinkProvider & {
  deleteProjectShareData: ReturnType<typeof vi.fn>;
} {
  return {
    kind: "mock",
    createShare: vi.fn(),
    listShares: vi.fn().mockResolvedValue([]),
    shareStatusBatch: vi.fn().mockResolvedValue({}),
    updateShare: vi.fn(),
    pushSnapshot: vi.fn().mockResolvedValue(undefined),
    regenerateShare: vi.fn(),
    revokeShare: vi.fn(),
    listComments: vi.fn().mockResolvedValue([]),
    submitComment: vi.fn(),
    setCommentResolved: vi.fn(),
    deleteComment: vi.fn(),
    resolvePublic: vi.fn(),
    deleteProjectShareData: vi.fn().mockResolvedValue({ revokedShares: 1, deletedComments: 2 }),
  } as ShareLinkProvider & { deleteProjectShareData: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  clearShareLocalCacheForTests();
  resetMockCloudState();
  resetMockShareState();
  setShareProviderForTests(null);
});

describe("export isolation", () => {
  it(".buildora export contains no share tokens even when cached on device", () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
    // A share token cached on the owner's device must never leak into exports.
    cacheShareToken("share-1", "secret-token-value-1234567890");
    const service = new ProjectExportService();
    const result = service.exportProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).not.toContain("secret-token-value-1234567890");
    expect(result.content).not.toContain("/share/");
    expect(result.content).not.toContain("shareId");
  });

  it("stray share-like fields attached to a project are stripped by the export schema", () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project & Record<string, unknown>;
    project.shareToken = "leak-me";
    project.reviewComments = [{ body: "secret feedback" }];
    const service = new ProjectExportService();
    const result = service.exportProject(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).not.toContain("leak-me");
    expect(result.content).not.toContain("secret feedback");
  });
});

describe("duplicate isolation", () => {
  it("duplicating a project creates no share links for the copy", async () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
    // Owner has an active share for the SOURCE project.
    const cloud = getMockCloudState();
    const token = handleSignup(cloud, { email: "a@example.com", password: "secret1" }).token;
    const shares = getMockShareState();
    handleCreateShare(shares, token, { projectId: project.id }, "http://localhost:3000");

    const service = new ProjectService(fakeAdapter(project));
    const result = await service.duplicateProject(project.id, []);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const copy = result.project;
    expect(copy.id).not.toBe(project.id);
    // The mock backend has no share rows for the copy's id.
    const copyShares = [...shares.shares.values()].filter((s) => s.projectId === copy.id);
    expect(copyShares).toHaveLength(0);
    // The duplicated project record itself carries no share metadata.
    expect(JSON.stringify(copy)).not.toContain("share");
    expect(JSON.stringify(copy)).not.toContain("rawToken");
  });
});

describe("delete cleanup", () => {
  it("deleting a project revokes/cleans its share data through the share provider", async () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
    const provider = shareProviderSpy();
    setShareProviderForTests(provider);

    const service = new ProjectService(fakeAdapter(project));
    const result = await service.deleteProject(project.id);
    expect(result.success).toBe(true);
    expect(provider.deleteProjectShareData).toHaveBeenCalledWith(project.id);
  });

  it("cleanup failure never fails the delete (best-effort, reported truthfully)", async () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
    const provider = shareProviderSpy();
    provider.deleteProjectShareData.mockRejectedValue(new Error("remote down"));
    setShareProviderForTests(provider);

    const service = new ProjectService(fakeAdapter(project));
    const result = await service.deleteProject(project.id);
    // The project is deleted; the cleanup failure is swallowed (surfaced via
    // the cleanup result contract, never by failing the delete).
    expect(result.success).toBe(true);
    expect(provider.deleteProjectShareData).toHaveBeenCalledWith(project.id);
  });

  it("deleting a project purges its cached raw tokens and share ids from the device", async () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
    // Simulate an active share created on this device with a cached token.
    setCachedShareIds(project.id, ["share-1"]);
    cacheShareToken("share-1", "device-token-abc-123");
    expect(cachedShareToken("share-1")).toBe("device-token-abc-123");
    expect(cachedShareIds(project.id)).toEqual(["share-1"]);

    const provider = shareProviderSpy();
    setShareProviderForTests(provider);
    const service = new ProjectService(fakeAdapter(project));
    const result = await service.deleteProject(project.id);
    expect(result.success).toBe(true);

    // Raw tokens must not outlive the deleted project on this device.
    expect(cachedShareIds(project.id)).toEqual([]);
    expect(cachedShareToken("share-1")).toBeNull();
  });
});

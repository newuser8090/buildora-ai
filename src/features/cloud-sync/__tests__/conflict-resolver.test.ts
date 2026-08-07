// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — conflict detection policy tests
//
// Pure decision logic: unchanged side vs changed side, delete vs edit,
// BlockTree-vs-BlockTree (never auto-resolved), metadata auto-merge.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { makeRecord, makeTree } from "@/features/my-blocks/__tests__/helpers";
import {
  decideBlockSync,
  cloudHashOfLocalBlock,
  cloudHashOfRemote,
  type BlockSyncContext,
} from "../services/conflict-resolver";
import type { CloudSyncMarker } from "../types";

function markerFor(record: ReturnType<typeof makeRecord>, cloudId: string, lastSyncedHash: string): CloudSyncMarker {
  return {
    key: `u:myBlock:${record.id}`,
    userId: "u",
    entityType: "myBlock",
    localEntityId: record.id,
    cloudEntityId: cloudId,
    lastSyncedUpdatedAt: record.updatedAt,
    lastSyncedContentRevision: record.contentRevision ?? 1,
    lastSyncedHash,
    updatedAt: record.updatedAt,
  };
}

function remoteOf(record: ReturnType<typeof makeRecord>, overrides: Record<string, unknown> = {}) {
  return {
    id: `cloud-${record.id}`,
    schemaVersion: 1,
    name: record.name,
    ...(record.description !== undefined ? { description: record.description } : {}),
    category: record.category,
    tags: record.tags,
    tree: record.tree,
    ...(record.sourceMetadata ? { sourceMetadata: record.sourceMetadata } : {}),
    previewMetadata: record.previewMetadata,
    contentRevision: record.contentRevision ?? 1,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    clientUpdatedAt: record.updatedAt,
    deletedAt: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<BlockSyncContext>): BlockSyncContext {
  const local = makeRecord({ id: "block-1", contentRevision: 1 });
  const remote = remoteOf(local);
  return {
    marker: null,
    local,
    remote,
    localCloudHash: cloudHashOfLocalBlock(local),
    remoteHash: cloudHashOfRemote(remote),
    ...overrides,
  };
}

describe("decideBlockSync — no baseline", () => {
  it("downloads a cloud-only record (apply-remote)", () => {
    const decision = decideBlockSync(ctx({ local: null }));
    expect(decision.kind).toBe("apply-remote");
  });

  it("uploads a local-only record (upload-local)", () => {
    const decision = decideBlockSync(ctx({ remote: null }));
    expect(decision.kind).toBe("upload-local");
  });

  it("links identical content (no duplicate copy)", () => {
    const local = makeRecord({ id: "block-1" });
    const remote = remoteOf(local);
    const decision = decideBlockSync(
      ctx({ local, remote, localCloudHash: cloudHashOfLocalBlock(local), remoteHash: cloudHashOfRemote(remote) }),
    );
    expect(decision.kind).toBe("link");
  });

  it("surfaces a review conflict when content differs without a baseline", () => {
    const local = makeRecord({ id: "block-1" });
    const remote = remoteOf(local, { name: "Renamed elsewhere" });
    const decision = decideBlockSync(
      ctx({
        local,
        remote,
        localCloudHash: cloudHashOfLocalBlock(local),
        remoteHash: cloudHashOfRemote(remote),
      }),
    );
    expect(decision.kind).toBe("conflict");
  });
});

describe("decideBlockSync — with a baseline marker", () => {
  it("no-op when neither side changed", () => {
    const local = makeRecord({ id: "block-1", contentRevision: 1 });
    const remote = remoteOf(local);
    const marker = markerFor(local, "cloud-block-1", cloudHashOfLocalBlock(local));
    const decision = decideBlockSync(
      ctx({ marker, local, remote, localCloudHash: cloudHashOfLocalBlock(local), remoteHash: cloudHashOfRemote(remote) }),
    );
    expect(decision.kind).toBe("no-op");
  });

  it("applies a remote-only change (unchanged side vs changed side)", () => {
    const local = makeRecord({ id: "block-1", contentRevision: 1 });
    const marker = markerFor(local, "cloud-block-1", cloudHashOfLocalBlock(local));
    const remote = remoteOf(local, { name: "Cloud rename", contentRevision: 2 });
    const decision = decideBlockSync(
      ctx({
        marker,
        local,
        remote,
        localCloudHash: cloudHashOfLocalBlock(local),
        remoteHash: cloudHashOfRemote(remote),
      }),
    );
    expect(decision.kind).toBe("apply-remote");
  });

  it("uploads a local-only change", () => {
    const local = makeRecord({ id: "block-1", contentRevision: 1 });
    const remote = remoteOf(local);
    const marker = markerFor(local, "cloud-block-1", cloudHashOfRemote(remote));
    const changed = { ...local, name: "Local rename", updatedAt: "2026-08-05T00:00:00.000Z" };
    const decision = decideBlockSync(
      ctx({
        marker,
        local: changed,
        remote,
        localCloudHash: cloudHashOfLocalBlock(changed),
        remoteHash: cloudHashOfRemote(remote),
      }),
    );
    expect(decision.kind).toBe("upload-local");
  });

  it("BlockTree changed on BOTH sides → conflict (never silent)", () => {
    const original = makeRecord({ id: "block-1", contentRevision: 1 });
    const marker = markerFor(original, "cloud-block-1", cloudHashOfLocalBlock(original));

    const localTree = makeTree();
    const remoteTree = makeTree();
    const local = { ...original, tree: localTree, contentRevision: 2, updatedAt: "2026-08-04T00:00:00.000Z" };
    const remote = remoteOf(original, { tree: remoteTree, contentRevision: 2, updatedAt: "2026-08-05T00:00:00.000Z" });

    const decision = decideBlockSync(
      ctx({ marker, local, remote, localCloudHash: cloudHashOfLocalBlock(local), remoteHash: cloudHashOfRemote(remote) }),
    );
    expect(decision.kind).toBe("conflict");
    if (decision.kind === "conflict") expect(decision.conflictKind).toBe("tree");
  });

  it("delete vs edit → conflict", () => {
    const original = makeRecord({ id: "block-1", contentRevision: 1 });
    const marker = markerFor(original, "cloud-block-1", cloudHashOfLocalBlock(original));
    // Local deleted (null), remote edited.
    const remote = remoteOf(original, { name: "Edited in cloud", updatedAt: "2026-08-05T00:00:00.000Z" });
    const decision = decideBlockSync(
      ctx({
        marker,
        local: null,
        remote,
        localCloudHash: "",
        remoteHash: cloudHashOfRemote(remote),
      }),
    );
    expect(decision.kind).toBe("conflict");
    if (decision.kind === "conflict") expect(decision.conflictKind).toBe("delete-edit");
  });

  it("one-sided remote delete with unchanged local → apply-remote (safe)", () => {
    const local = makeRecord({ id: "block-1", contentRevision: 1 });
    const marker = markerFor(local, "cloud-block-1", cloudHashOfLocalBlock(local));
    const remote = remoteOf(local, { deletedAt: "2026-08-06T00:00:00.000Z" });
    const decision = decideBlockSync(
      ctx({
        marker,
        local,
        remote,
        localCloudHash: cloudHashOfLocalBlock(local),
        remoteHash: cloudHashOfRemote(remote),
      }),
    );
    expect(decision.kind).toBe("apply-remote");
  });

  it("metadata-only changes on both sides auto-merge with recency", () => {
    const original = makeRecord({ id: "block-1", contentRevision: 1 });
    const marker = markerFor(original, "cloud-block-1", cloudHashOfLocalBlock(original));
    const local = { ...original, name: "Local name", updatedAt: "2026-08-05T00:00:00.000Z" };
    const remote = remoteOf(original, { name: "Cloud name", updatedAt: "2026-08-04T00:00:00.000Z" });
    const decision = decideBlockSync(
      ctx({
        marker,
        local,
        remote,
        localCloudHash: cloudHashOfLocalBlock(local),
        remoteHash: cloudHashOfRemote(remote),
      }),
    );
    expect(decision.kind).toBe("auto-merge");
    if (decision.kind === "auto-merge") {
      expect((decision.merged as { name: string }).name).toBe("Local name"); // newer wins
    }
  });
});

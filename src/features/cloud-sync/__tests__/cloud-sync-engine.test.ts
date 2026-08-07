// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — sync engine integration tests
//
// Uses the InMemoryCloudLibraryProvider (mirrors server enforcement) plus the
// real IndexedDB-backed queue/markers/conflicts/writer and the canonical My
// Blocks adapter on fake-indexeddb. Covers: upload, download, delta sync,
// idempotency, no echo loop, offline, tombstones, conflict detection, and the
// durable keep-local / keep-cloud / keep-both resolutions.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { DATABASE_VERSION } from "@/features/persistence/constants";
import { InMemoryCloudLibraryProvider } from "../providers/in-memory-cloud-provider";
import { CloudSyncQueue } from "../queue/cloud-sync-queue";
import { CloudSyncMarkers } from "../markers/cloud-sync-markers";
import { CloudConflictStore } from "../conflicts/cloud-conflict-store";
import { RawLibraryWriter, CloudRemoteApplier } from "../services/remote-apply";
import { CloudSyncEngine } from "../services/cloud-sync-engine";
import { ConflictResolverService } from "../services/conflict-resolution";
import { InitialMergeService } from "../services/initial-merge";
import { SyncMetadataStore } from "../sync-metadata-store";
import { SyncEnqueuer } from "../services/sync-enqueuer";
import { MyBlocksIndexedDbAdapter } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import { makeTree, makeRecord } from "@/features/my-blocks/__tests__/helpers";
import { myBlockToCloud } from "../serialization/cloud-serializer";
import type { CloudSessionUser } from "../providers/cloud-library-provider";
import type { MyBlockRecord } from "@/features/my-blocks/types";

const USER_A: CloudSessionUser = { id: "user-a", email: "a@example.com" };

let dbCounter = 0;

interface Fixture {
  provider: InMemoryCloudLibraryProvider;
  queue: CloudSyncQueue;
  markers: CloudSyncMarkers;
  conflicts: CloudConflictStore;
  writer: RawLibraryWriter;
  applier: CloudRemoteApplier;
  adapter: MyBlocksIndexedDbAdapter;
  engine: CloudSyncEngine;
  enqueuer: SyncEnqueuer;
  metadata: SyncMetadataStore;
}

function buildFixture(options?: { online?: boolean }): Fixture {
  dbCounter += 1;
  const dbName = `engine-test-${dbCounter}`;
  const provider = new InMemoryCloudLibraryProvider();
  provider.setCurrentUser(USER_A);

  const queue = new CloudSyncQueue({ dbName, dbVersion: DATABASE_VERSION });
  const markers = new CloudSyncMarkers({ dbName, dbVersion: DATABASE_VERSION });
  const conflicts = new CloudConflictStore({ dbName, dbVersion: DATABASE_VERSION });
  const writer = new RawLibraryWriter({ dbName, dbVersion: DATABASE_VERSION });
  // Scoped metadata per fixture — cursors/decisions never leak between
  // fixtures the way a module-level default database would.
  const metadata = new SyncMetadataStore({ dbName, dbVersion: DATABASE_VERSION });
  const applier = new CloudRemoteApplier({
    writer,
    markers: {
      put: (marker) => markers.putMarker(marker),
      remove: (userId, entityType, localId) => markers.removeMarker(userId, entityType, localId),
    },
    ensureThumbnail: async () => undefined,
  });
  const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: DATABASE_VERSION });
  const engine = new CloudSyncEngine({
    provider,
    queue,
    markers,
    conflicts,
    applier,
    writer,
    adapter,
    isOnline: () => options?.online ?? true,
    onRefresh: () => undefined,
    deleteThumbnail: async () => undefined,
    metadata,
  });
  const enqueuer = new SyncEnqueuer({
    queue,
    adapter,
    onQueued: () => undefined,
  });
  return { provider, queue, markers, conflicts, writer, applier, adapter, engine, enqueuer, metadata };
}

async function createAndEnqueue(fx: Fixture, overrides: Partial<MyBlockRecord> = {}): Promise<MyBlockRecord> {
  const created = await fx.adapter.createMyBlock({
    name: overrides.name ?? "Hero",
    category: "layout",
    tree: makeTree(),
    ...(overrides.description ? { description: overrides.description } : {}),
  });
  if (!created.ok) throw new Error("create failed");
  const record = created.value;
  await fx.enqueuer.handleLocalMutation(
    { entityType: "myBlock", entityId: record.id, operation: "upsert" },
    USER_A.id,
  );
  return record;
}

describe("CloudSyncEngine — upload / download", () => {
  it("uploads a local block to the cloud and acks the queue", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    const report = await fx.engine.run(USER_A.id);

    expect(report.uploaded).toBe(1);
    expect(report.status).toBe("synced");
    const cloudBlock = fx.provider.blocks.get(`cloud-${record.id}`);
    expect(cloudBlock).toBeDefined();
    expect(cloudBlock?.name).toBe(record.name);
    expect(await fx.queue.countPending(USER_A.id)).toBe(0);
    const marker = await fx.markers.getMarker(USER_A.id, "myBlock", record.id);
    expect(marker?.cloudEntityId).toBe(`cloud-${record.id}`);
  });

  it("downloads a cloud block to the local library (delta sync)", async () => {
    const fx = buildFixture();
    // Simulate another device having uploaded a block.
    const remoteRecord = makeRecord({ id: "device-b-block", name: "From device B" });
    const serialized = myBlockToCloud(remoteRecord, { deviceId: "dev-b" });
    if (!serialized.ok) throw new Error("serialization failed");
    fx.provider.blocks.set(serialized.payload.id, serialized.payload);

    const report = await fx.engine.run(USER_A.id);
    expect(report.downloaded).toBe(1);

    const list = await fx.adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) {
      const names = list.value.map((b) => b.name);
      expect(names).toContain("From device B");
    }
  });

  it("does not echo-loop: remote applies never emit local mutation events", async () => {
    const fx = buildFixture();
    const remoteRecord = makeRecord({ id: "device-b-block", name: "From device B" });
    const serialized = myBlockToCloud(remoteRecord, { deviceId: "dev-b" });
    if (!serialized.ok) throw new Error("serialization failed");
    fx.provider.blocks.set(serialized.payload.id, serialized.payload);

    const mutationSpy = { calls: 0 };
    fx.adapter.setLocalMutationListener(() => {
      mutationSpy.calls += 1;
    });

    await fx.engine.run(USER_A.id);
    expect(mutationSpy.calls).toBe(0);
  });

  it("is idempotent: a second run uploads/creates nothing new", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);
    const first = await fx.adapter.listMyBlocks();
    await fx.engine.run(USER_A.id);
    const second = await fx.adapter.listMyBlocks();
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value).toHaveLength(first.value.length);
    }
    expect(fx.provider.blocks.size).toBe(1);
    expect(await fx.queue.countPending(USER_A.id)).toBe(0);
    expect(record.id).toBeTruthy();
  });

  it("reports offline and changes nothing when offline", async () => {
    const fx = buildFixture({ online: false });
    const record = await createAndEnqueue(fx);
    const report = await fx.engine.run(USER_A.id);
    expect(report.status).toBe("offline");
    expect(fx.provider.blocks.size).toBe(0);
    // The local record + queue entry are untouched and safe.
    expect(await fx.queue.countPending(USER_A.id)).toBe(1);
    const local = await fx.adapter.getMyBlock(record.id);
    expect(local.ok).toBe(true);
  });

  it("applies tombstones: a deleted local block soft-deletes the cloud copy", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);
    expect(fx.provider.blocks.get(`cloud-${record.id}`)?.deletedAt).toBeFalsy();

    await fx.adapter.deleteMyBlock(record.id);
    await fx.enqueuer.handleLocalMutation(
      { entityType: "myBlock", entityId: record.id, operation: "delete" },
      USER_A.id,
    );
    await fx.engine.run(USER_A.id);

    const cloud = fx.provider.blocks.get(`cloud-${record.id}`);
    expect(cloud?.deletedAt).toBeTruthy();
    expect(await fx.queue.countPending(USER_A.id)).toBe(0);
  });
});

describe("CloudSyncEngine — conflicts", () => {
  it("detects a BlockTree conflict when both sides changed", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);

    // Local changes: bump tree epoch + metadata.
    const localUpdate = await fx.adapter.updateMyBlock(record.id, {
      name: "Local hero",
      contentRevision: 2,
    });
    expect(localUpdate.ok).toBe(true);
    await fx.enqueuer.handleLocalMutation(
      { entityType: "myBlock", entityId: record.id, operation: "upsert" },
      USER_A.id,
    );

    // Remote changes: bump tree epoch + metadata.
    const cloud = fx.provider.blocks.get(`cloud-${record.id}`);
    expect(cloud).toBeDefined();
    fx.provider.blocks.set(`cloud-${record.id}`, {
      ...cloud!,
      name: "Cloud hero",
      contentRevision: 2,
      updatedAt: "2026-08-06T00:00:00.000Z",
    });

    const report = await fx.engine.run(USER_A.id);
    expect(report.status).toBe("conflict");
    const open = await fx.conflicts.listOpen(USER_A.id);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe("tree");
    // Neither side was overwritten.
    const stillLocal = await fx.adapter.getMyBlock(record.id);
    expect(stillLocal.ok && stillLocal.value.name).toBe("Local hero");
    const cloudAfter = fx.provider.blocks.get(`cloud-${record.id}`);
    expect(cloudAfter?.name).toBe("Cloud hero");
  });

  it("resolves keep-local: the local version wins", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);
    await fx.adapter.updateMyBlock(record.id, { name: "Local hero", contentRevision: 2 });
    await fx.enqueuer.handleLocalMutation(
      { entityType: "myBlock", entityId: record.id, operation: "upsert" },
      USER_A.id,
    );
    const cloud = fx.provider.blocks.get(`cloud-${record.id}`);
    fx.provider.blocks.set(`cloud-${record.id}`, {
      ...cloud!,
      name: "Cloud hero",
      contentRevision: 2,
      updatedAt: "2026-08-06T00:00:00.000Z",
    });
    await fx.engine.run(USER_A.id);

    const [conflict] = await fx.conflicts.listOpen(USER_A.id);
    const resolver = new ConflictResolverService({
      conflicts: fx.conflicts,
      markers: fx.markers,
      queue: fx.queue,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      onRefresh: () => undefined,
    });
    await resolver.resolve(USER_A.id, conflict.id, "keep-local");

    // Conflict is durably resolved and a force-upload is queued.
    const after = await fx.conflicts.getConflict(conflict.id);
    expect(after?.status).toBe("resolved-keep-local");
    const pending = await fx.queue.list(USER_A.id, { includeDeferred: true });
    expect(pending.some((e) => e.entityId === record.id && e.operation === "upsert")).toBe(true);
  });

  it("resolves keep-cloud: the cloud version replaces the local record", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);
    await fx.adapter.updateMyBlock(record.id, { name: "Local hero", contentRevision: 2 });
    await fx.enqueuer.handleLocalMutation(
      { entityType: "myBlock", entityId: record.id, operation: "upsert" },
      USER_A.id,
    );
    const cloud = fx.provider.blocks.get(`cloud-${record.id}`);
    const cloudTree = makeTree();
    fx.provider.blocks.set(`cloud-${record.id}`, {
      ...cloud!,
      name: "Cloud hero",
      tree: cloudTree,
      contentRevision: 2,
      updatedAt: "2026-08-06T00:00:00.000Z",
    });
    await fx.engine.run(USER_A.id);

    const [conflict] = await fx.conflicts.listOpen(USER_A.id);
    const resolver = new ConflictResolverService({
      conflicts: fx.conflicts,
      markers: fx.markers,
      queue: fx.queue,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      onRefresh: () => undefined,
    });
    await resolver.resolve(USER_A.id, conflict.id, "keep-cloud");

    const local = await fx.adapter.getMyBlock(record.id);
    expect(local.ok && local.value.name).toBe("Cloud hero");
    expect(local.ok && local.value.tree).toEqual(cloudTree);
  });

  it("resolves keep-both: two independent records with fresh ids", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);
    await fx.adapter.updateMyBlock(record.id, { name: "Local hero", contentRevision: 2 });
    await fx.enqueuer.handleLocalMutation(
      { entityType: "myBlock", entityId: record.id, operation: "upsert" },
      USER_A.id,
    );
    const cloud = fx.provider.blocks.get(`cloud-${record.id}`);
    fx.provider.blocks.set(`cloud-${record.id}`, {
      ...cloud!,
      name: "Cloud hero",
      tree: makeTree(),
      contentRevision: 2,
      updatedAt: "2026-08-06T00:00:00.000Z",
    });
    await fx.engine.run(USER_A.id);

    const [conflict] = await fx.conflicts.listOpen(USER_A.id);
    const resolver = new ConflictResolverService({
      conflicts: fx.conflicts,
      markers: fx.markers,
      queue: fx.queue,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      onRefresh: () => undefined,
    });
    await resolver.resolve(USER_A.id, conflict.id, "keep-both");

    const list = await fx.adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(2); // original local + fresh cloud copy
      const names = list.value.map((b) => b.name).sort();
      expect(names).toContain("Local hero");
      expect(names.some((n) => n.startsWith("Cloud hero"))).toBe(true);
      const ids = new Set(list.value.map((b) => b.id));
      expect(ids.size).toBe(2); // independent, non-colliding ids
    }
  });

  it("rejects resolution attempts by another user (permission-safe)", async () => {
    const fx = buildFixture();
    const record = await createAndEnqueue(fx);
    await fx.engine.run(USER_A.id);
    await fx.adapter.updateMyBlock(record.id, { name: "Local hero", contentRevision: 2 });
    await fx.enqueuer.handleLocalMutation(
      { entityType: "myBlock", entityId: record.id, operation: "upsert" },
      USER_A.id,
    );
    const cloud = fx.provider.blocks.get(`cloud-${record.id}`);
    fx.provider.blocks.set(`cloud-${record.id}`, {
      ...cloud!,
      name: "Cloud hero",
      contentRevision: 2,
      updatedAt: "2026-08-06T00:00:00.000Z",
    });
    await fx.engine.run(USER_A.id);

    const [conflict] = await fx.conflicts.listOpen(USER_A.id);
    const resolver = new ConflictResolverService({
      conflicts: fx.conflicts,
      markers: fx.markers,
      queue: fx.queue,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      onRefresh: () => undefined,
    });
    await expect(resolver.resolve("user-other", conflict.id, "keep-local")).rejects.toBeTruthy();
  });
});

describe("CloudSyncEngine — provider delta sync", () => {
  it("paginates deltas through the provider without losing records", async () => {
    const fx = buildFixture();
    // Seed 5 cloud blocks (as if uploaded by another device).
    const serialized: { id: string; updatedAt: string }[] = [];
    for (let i = 0; i < 5; i += 1) {
      const record = makeRecord({ id: `b-${i}`, name: `Block ${i}` });
      const s = myBlockToCloud(record, { deviceId: "dev-b" });
      if (!s.ok) throw new Error("serialization failed");
      fx.provider.blocks.set(s.payload.id, {
        ...s.payload,
        updatedAt: `2026-08-0${i + 1}T00:00:00.000Z`,
      });
      serialized.push({ id: s.payload.id, updatedAt: `2026-08-0${i + 1}T00:00:00.000Z` });
    }

    // Manual delta walk with a small page size.
    const page = await fx.provider.fetchChanges(null, 2);
    expect(page.blocks.length).toBeGreaterThan(0);
    expect(page.hasMore).toBe(true);
    let cursor = page.cursor;
    let seen = page.blocks.length;
    while (page.hasMore) {
      const next = await fx.provider.fetchChanges(cursor, 2);
      seen += next.blocks.length;
      cursor = next.cursor;
      if (!next.hasMore) break;
    }
    expect(seen).toBe(5);
    expect(fx.provider.blocks.size).toBe(5);
    void serialized;
  });
});

describe("InitialMergeService", () => {
  it("merges: links content-matched blocks and applies cloud-only ones", async () => {
    const fx = buildFixture();
    // Local block.
    const local = await createAndEnqueue(fx); // "Hero"
    // Cloud: same content (matches by hash) + one cloud-only block.
    const localSerialized = myBlockToCloud(local, { deviceId: "dev-b" });
    if (!localSerialized.ok) throw new Error("serialization failed");
    fx.provider.blocks.set(localSerialized.payload.id, localSerialized.payload);

    const cloudOnly = makeRecord({ id: "cloud-only-block", name: "Only in cloud" });
    const cloudOnlySerialized = myBlockToCloud(cloudOnly, { deviceId: "dev-b" });
    if (!cloudOnlySerialized.ok) throw new Error("serialization failed");
    fx.provider.blocks.set(cloudOnlySerialized.payload.id, cloudOnlySerialized.payload);

    const merge = new InitialMergeService({
      provider: fx.provider,
      markers: fx.markers,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      metadata: fx.metadata,
    });

    const summary = await merge.computeSummary(USER_A.id);
    expect(summary.matchedCount).toBe(1);
    expect(summary.cloudOnlyCount).toBe(1);

    const result = await merge.execute(USER_A.id, "merge");
    expect(result.matchedCount).toBe(1);

    // No duplicate of the matched block locally; the cloud-only block was added.
    const list = await fx.adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) {
      const heroes = list.value.filter((b) => b.name === local.name);
      expect(heroes).toHaveLength(1); // linked, not duplicated
      expect(list.value.some((b) => b.name === "Only in cloud")).toBe(true);
    }
    // A marker links the local record to the cloud record.
    const marker = await fx.markers.getMarker(USER_A.id, "myBlock", local.id);
    expect(marker?.cloudEntityId).toBe(localSerialized.payload.id);
  });

  it("never deduplicates by name alone", async () => {
    const fx = buildFixture();
    const local = await createAndEnqueue(fx);
    // Same NAME but different content.
    const different = makeRecord({ id: "different-content", name: local.name });
    const differentTree = makeTree();
    const s = myBlockToCloud({ ...different, tree: differentTree }, { deviceId: "dev-b" });
    if (!s.ok) throw new Error("serialization failed");
    fx.provider.blocks.set(s.payload.id, s.payload);

    const merge = new InitialMergeService({
      provider: fx.provider,
      markers: fx.markers,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      metadata: fx.metadata,
    });
    const summary = await merge.computeSummary(USER_A.id);
    // Same name but different content → NOT a match.
    expect(summary.matchedCount).toBe(0);
    await merge.execute(USER_A.id, "merge");
    const list = await fx.adapter.listMyBlocks();
    expect(list.ok && list.value.length).toBe(2);
  });

  it("records a durable decision so the flow runs once per user", async () => {
    const fx = buildFixture();
    const merge = new InitialMergeService({
      provider: fx.provider,
      markers: fx.markers,
      applier: fx.applier,
      writer: fx.writer,
      adapter: fx.adapter,
      deleteThumbnail: async () => undefined,
      metadata: fx.metadata,
    });
    expect(await merge.hasDecision(USER_A.id)).toBe(false);
    await merge.recordDecision(USER_A.id, "merge");
    expect(await merge.hasDecision(USER_A.id)).toBe(true);
  });
});

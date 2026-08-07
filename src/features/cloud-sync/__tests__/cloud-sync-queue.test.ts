// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — durable sync queue tests
//
// IndexedDB-backed queue: survives reload, deduplicates superseded intents,
// bounded retry/backoff, user-switch isolation, and first-connection store
// creation (every adapter must create all current stores).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { CloudSyncQueue } from "../queue/cloud-sync-queue";
import { DATABASE_VERSION } from "@/features/persistence/constants";

let counter = 0;
function makeQueue() {
  counter += 1;
  return new CloudSyncQueue({ dbName: `queue-test-${counter}`, dbVersion: DATABASE_VERSION });
}

const enqueueInput = (overrides: Partial<Parameters<CloudSyncQueue["enqueue"]>[0]> = {}) => ({
  userId: "user-1",
  entityType: "myBlock" as const,
  entityId: "block-1",
  operation: "upsert" as const,
  localRevision: 1,
  payloadHash: "hash-a",
  now: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("CloudSyncQueue", () => {
  it("first connection creates every current store", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput());
    const open = indexedDB.open(`queue-test-${counter}`);
    const names = await new Promise<string[]>((resolve, reject) => {
      open.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(Array.from(db.objectStoreNames));
        db.close();
      };
      open.onerror = () => reject(open.error);
    });
    for (const expected of [
      "projects",
      "metadata",
      "projectThumbnails",
      "myBlocks",
      "myBlockThumbnails",
      "myBlockCollections",
      "cloudSyncQueue",
      "cloudSyncMarkers",
      "cloudSyncConflicts",
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).toHaveLength(9);
    await queue.clearForTests();
  });

  it("deduplicates superseded operations for the same entity", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput({ payloadHash: "hash-a" }));
    await queue.enqueue(enqueueInput({ payloadHash: "hash-b" })); // supersedes hash-a
    const entries = await queue.list("user-1", { includeDeferred: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].payloadHash).toBe("hash-b");
    await queue.clearForTests();
  });

  it("keeps one entry per user+entity (delete replaces upsert)", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput());
    await queue.enqueue(enqueueInput({ operation: "delete", payloadHash: "" }));
    const entries = await queue.list("user-1", { includeDeferred: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe("delete");
    await queue.clearForTests();
  });

  it("acks remove the entry (queue cleanup after acknowledged sync)", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput());
    const [entry] = await queue.list("user-1", { includeDeferred: true });
    await queue.ack(entry.id);
    expect(await queue.countPending("user-1")).toBe(0);
    await queue.clearForTests();
  });

  it("isolates entries per user (sign-out / account switch safe)", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput({ userId: "user-1", entityId: "block-1" }));
    await queue.enqueue(enqueueInput({ userId: "user-2", entityId: "block-2" }));
    const user1 = await queue.list("user-1", { includeDeferred: true });
    const user2 = await queue.list("user-2", { includeDeferred: true });
    expect(user1.map((e) => e.entityId)).toEqual(["block-1"]);
    expect(user2.map((e) => e.entityId)).toEqual(["block-2"]);
    await queue.clearForTests();
  });

  it("markRetry applies bounded backoff (excluded until nextRetryAt)", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput());
    const [entry] = await queue.list("user-1", { includeDeferred: true });
    await queue.markRetry(entry.id, {
      errorCode: "NETWORK_FAILED",
      nextRetryAt: "2999-01-01T00:00:00.000Z",
      retryCount: 1,
    });
    // Not ready until the backoff elapses.
    const ready = await queue.list("user-1", { now: "2026-08-01T00:00:00.000Z" });
    expect(ready).toHaveLength(0);
    // Still visible to the user (pending count + diagnostics).
    const deferred = await queue.list("user-1", { includeDeferred: true });
    expect(deferred).toHaveLength(1);
    expect(deferred[0].lastErrorCode).toBe("NETWORK_FAILED");
    await queue.clearForTests();
  });

  it("migrates unsigned (device-local) entries to the signing-in user", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput({ userId: "__unsigned__", entityId: "block-x" }));
    const migrated = await queue.migrateUnsignedEntries("user-1");
    expect(migrated).toBe(1);
    const entries = await queue.list("user-1", { includeDeferred: true });
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe("user-1");
    expect(entries[0].entityId).toBe("block-x");
    await queue.clearForTests();
  });

  it("clearForUser removes only that user's entries", async () => {
    const queue = makeQueue();
    await queue.enqueue(enqueueInput({ userId: "user-1", entityId: "block-1" }));
    await queue.enqueue(enqueueInput({ userId: "user-2", entityId: "block-2" }));
    await queue.clearForUser("user-1");
    expect(await queue.countPending("user-1")).toBe(0);
    expect(await queue.countPending("user-2")).toBe(1);
    await queue.clearForTests();
  });
});

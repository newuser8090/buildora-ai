// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — serializer / deserializer unit tests
//
// Security-critical surface: local records become validated cloud payloads,
// and remote JSON is only trusted after schema validation. No raw source,
// no object URLs, no local-only UI fields; dangerous keys and unsupported
// versions are rejected; payloads are size-capped.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { makeRecord, makeTree } from "@/features/my-blocks/__tests__/helpers";
import {
  myBlockToCloud,
  collectionToCloud,
  cloudToMyBlock,
  parseCloudMyBlockPayload,
  parseCloudMyBlockCollectionPayload,
} from "../serialization/cloud-serializer";
import type { MyBlockRecord, MyBlockCollection } from "@/features/my-blocks/types";
import type { CloudMyBlockPayload } from "../types";

function makeCollection(overrides?: Partial<MyBlockCollection>): MyBlockCollection {
  return {
    id: "col-1",
    version: 1,
    name: "Landing",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    sortOrder: 0,
    ...overrides,
  };
}

function cloudPayloadOf(record: MyBlockRecord): CloudMyBlockPayload {
  const result = myBlockToCloud(record, { deviceId: "dev-test" });
  if (!result.ok) throw new Error("serialization failed");
  return result.payload;
}

describe("myBlockToCloud", () => {
  it("preserves the validated native model + contentRevision", () => {
    const record = makeRecord({ contentRevision: 4 });
    const payload = cloudPayloadOf(record);
    expect(payload.name).toBe(record.name);
    expect(payload.contentRevision).toBe(4);
    expect(payload.tree.rootIds).toEqual(record.tree.rootIds);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.deletedAt).toBeNull();
  });

  it("strips local-only UI fields (favorite, useCount, lastUsedAt, thumbnail)", () => {
    const record = makeRecord({
      favorite: true,
      useCount: 7,
      lastUsedAt: "2026-08-02T00:00:00.000Z",
      thumbnail: {
        revision: 1,
        generatedAt: "2026-08-02T00:00:00.000Z",
        mimeType: "image/webp",
        width: 480,
        height: 300,
        byteSize: 1024,
        hash: "abc",
      },
    });
    const payload = cloudPayloadOf(record);
    expect("favorite" in payload).toBe(false);
    expect("useCount" in payload).toBe(false);
    expect("lastUsedAt" in payload).toBe(false);
    expect("thumbnail" in payload).toBe(false);
  });

  it("carries the device id for diagnostics and normalizes timestamps", () => {
    const record = makeRecord();
    const payload = cloudPayloadOf(record);
    expect(payload.deviceId).toBe("dev-test");
    expect(payload.clientUpdatedAt).toBe(record.updatedAt);
    expect(Number.isNaN(Date.parse(payload.updatedAt))).toBe(false);
  });

  it("assigns a provisional deterministic cloud id", () => {
    const record = makeRecord({ id: "myblock-abc" });
    const payload = cloudPayloadOf(record);
    expect(payload.id).toBe("cloud-myblock-abc");
  });

  it("rejects oversized records with a structured error", () => {
    const bigTree = makeTree();
    bigTree.nodes = {};
    const hugeProps = { text: "x".repeat(2 * 1024 * 1024) };
    bigTree.nodes["n1"] = {
      id: "n1",
      type: "paragraph",
      parentId: null,
      children: [],
      props: hugeProps,
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    };
    bigTree.rootIds = ["n1"];
    const record = makeRecord({ tree: bigTree });
    const result = myBlockToCloud(record);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REMOTE_VALIDATION_FAILED");
  });
});

describe("cloudToMyBlock", () => {
  it("rebuilds a validated record with the requested local id", () => {
    const payload = cloudPayloadOf(makeRecord({ id: "myblock-orig", contentRevision: 2 }));
    const result = cloudToMyBlock({ payload, localId: "myblock-fresh" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.id).toBe("myblock-fresh");
      expect(result.record.name).toBe(payload.name);
      expect(result.record.contentRevision).toBe(2);
      expect(result.record.tree.rootIds).toEqual(payload.tree.rootIds);
    }
  });

  it("does not copy favorite/usage/thumbnail fields from the cloud", () => {
    const payload = cloudPayloadOf(makeRecord());
    const result = cloudToMyBlock({ payload, localId: "myblock-x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.favorite).toBeUndefined();
      expect(result.record.useCount).toBeUndefined();
      expect(result.record.thumbnail).toBeUndefined();
    }
  });
});

describe("remote payload parsing (parseCloudMyBlockPayload)", () => {
  it("accepts a well-formed validated payload", () => {
    const payload = cloudPayloadOf(makeRecord());
    const result = parseCloudMyBlockPayload(JSON.parse(JSON.stringify(payload)));
    expect(result.ok).toBe(true);
  });

  it("rejects null / non-object values", () => {
    expect(parseCloudMyBlockPayload(null).ok).toBe(false);
    expect(parseCloudMyBlockPayload("nope").ok).toBe(false);
  });

  it("rejects unsupported remote schema versions", () => {
    const payload = cloudPayloadOf(makeRecord()) as unknown as Record<string, unknown>;
    const newer = { ...payload, schemaVersion: 99 };
    const result = parseCloudMyBlockPayload(newer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_REMOTE_VERSION");
  });

  it("rejects dangerous keys nested inside the tree", () => {
    const payload = cloudPayloadOf(makeRecord());
    const raw = JSON.parse(JSON.stringify(payload)) as {
      tree: { rootIds: string[]; nodes: Record<string, Record<string, unknown>> };
    };
    const node = raw.tree.nodes[raw.tree.rootIds[0]] as Record<string, unknown>;
    node["dangerouslySetInnerHTML"] = { __html: "<script>alert(1)</script>" };
    const result = parseCloudMyBlockPayload(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REMOTE_VALIDATION_FAILED");
  });

  it("rejects malformed trees (no root ids)", () => {
    const payload = cloudPayloadOf(makeRecord());
    const raw = JSON.parse(JSON.stringify(payload)) as { tree: { rootIds: string[] } };
    raw.tree.rootIds = [];
    const result = parseCloudMyBlockPayload(raw);
    expect(result.ok).toBe(false);
  });
});

describe("collections", () => {
  it("collectionToCloud resolves membership through markers", () => {
    const collection = makeCollection({ id: "col-1" });
    const blockA = makeRecord({ id: "block-a" });
    const blockB = makeRecord({ id: "block-b" });
    // Only block-a is a member, and only block-a has a cloud marker.
    const aWithMember: MyBlockRecord = { ...blockA, collectionIds: ["col-1"] };
    const markers = new Map([
      ["myBlock:block-a", {
        key: "u:myBlock:block-a",
        userId: "u",
        entityType: "myBlock" as const,
        localEntityId: "block-a",
        cloudEntityId: "cloud-block-a",
        lastSyncedUpdatedAt: "2026-08-01T00:00:00.000Z",
        lastSyncedContentRevision: 1,
        lastSyncedHash: "h",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
    ]);
    const result = collectionToCloud(collection, [aWithMember, blockB], markers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.blockIds).toEqual(["cloud-block-a"]);
    }
  });

  it("cloudToMyBlockCollection round-trips the name/sortOrder", () => {
    const collection = makeCollection({ name: "Heroes", sortOrder: 3 });
    const cloud = collectionToCloud(collection, [], new Map());
    if (!cloud.ok) throw new Error("serialization failed");
    const result = parseCloudMyBlockCollectionPayload(JSON.parse(JSON.stringify(cloud.payload)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Heroes");
      expect(result.value.sortOrder).toBe(3);
    }
  });
});

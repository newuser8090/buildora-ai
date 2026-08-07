// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — cloud-safe serialization
//
// MyBlockRecord ↔ CloudMyBlockPayload (and collection equivalents). Rules:
//   - strip local-only UI fields (favorite, thumbnail metadata, useCount,
//     lastUsedAt, collectionIds) — thumbnails are regenerable, never uploaded
//   - membership lives on the CLOUD COLLECTION record (blockIds resolved
//     through sync markers) so block payloads never need id remapping
//   - never serialize raw pasted source (the record already holds a
//     validated native BlockTree)
//   - never serialize object URLs (records never contain them)
//   - reject dangerous keys at any depth
//   - reject unsupported versions
//   - cap payload sizes
//   - normalize timestamps to ISO strings
//   - preserve contentRevision (tree epoch)
//   - remote JSON is only trusted after schema validation
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { BlockTree } from "@/features/blocks/types";
import {
  MyBlockRecordSchema,
  parseMyBlockRecord,
  parseMyBlockCollection,
} from "@/features/my-blocks/schemas/my-block-schema";
import { findDangerousKeys } from "@/features/code-import/schemas/custom-block-schema";
import type {
  MyBlockCollection,
  MyBlockRecord,
  MyBlockSourceMetadata,
} from "@/features/my-blocks/types";
import {
  CLOUD_MAX_PAYLOAD_BYTES,
  CLOUD_SCHEMA_VERSION,
} from "../constants";
import { makeCloudSyncError, type CloudSyncError } from "../errors";
import type {
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudSyncMarker,
} from "../types";

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

/** Composite marker key WITHOUT the user id (used for serialization lookups). */
export function entityMarkerKey(
  entityType: "myBlock" | "collection",
  localEntityId: string,
): string {
  return `${entityType}:${localEntityId}`;
}

/** Resolve the cloud id for a local entity through the marker map. */
export function resolveCloudId(
  markers: ReadonlyMap<string, CloudSyncMarker>,
  entityType: "myBlock" | "collection",
  localEntityId: string,
): string | undefined {
  return markers.get(entityMarkerKey(entityType, localEntityId))?.cloudEntityId;
}

// ---------------------------------------------------------------------------
// Remote payload schemas (Zod) — the ONLY way remote JSON is trusted
// ---------------------------------------------------------------------------

const isoDate = z.string().min(1).max(64);

const CloudSourceMetadataSchema = z
  .object({
    source: z.enum(["imported", "created", "duplicated", "shared"]),
    language: z
      .enum(["html", "jsx", "tsx", "react", "css", "unknown"])
      .optional(),
    originalWarningCount: z.number().int().nonnegative().optional(),
    converterVersion: z.number().int().positive().optional(),
  })
  .strict();

const CloudPreviewMetadataSchema = z
  .object({
    blockCount: z.number().int().positive(),
    rootType: z.string().min(1).max(120),
    containsMedia: z.boolean(),
    containsInteractive: z.boolean(),
  })
  .strict();

export const CloudMyBlockPayloadSchema = z
  .object({
    id: z.string().min(1).max(120),
    schemaVersion: z.number().int().positive().max(CLOUD_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(280).optional(),
    category: z.string().min(1).max(40),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    // Reuses the custom-block tree schema — structural validation, nesting
    // caps, and dangerous-key rejection at the props/style level.
    tree: MyBlockRecordSchema.shape.tree,
    sourceMetadata: CloudSourceMetadataSchema.optional(),
    previewMetadata: CloudPreviewMetadataSchema,
    contentRevision: z.number().int().positive(),
    createdAt: isoDate,
    updatedAt: isoDate,
    clientUpdatedAt: isoDate,
    deviceId: z.string().min(1).max(160).optional(),
    deletedAt: isoDate.nullable().optional(),
  })
  .strict();

export const CloudMyBlockCollectionPayloadSchema = z
  .object({
    id: z.string().min(1).max(120),
    schemaVersion: z.number().int().positive().max(CLOUD_SCHEMA_VERSION),
    name: z.string().trim().min(1).max(60),
    description: z.string().max(160).optional(),
    createdAt: isoDate,
    updatedAt: isoDate,
    sortOrder: z.number().int().nonnegative(),
    blockIds: z.array(z.string().min(1).max(120)).max(500).default([]),
    deletedAt: isoDate.nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** True when a cloud block payload is structurally usable (has a tree). */
export function isUsableCloudBlockPayload(
  value: unknown,
): value is CloudMyBlockPayload {
  const result = CloudMyBlockPayloadSchema.safeParse(value);
  if (!result.success) return false;
  return result.data.tree.rootIds.length > 0;
}

/**
 * Execution-adjacent keys that are rejected at ANY depth in cloud payloads
 * (beyond the prototype-pollution + unsafe-CSS policy already applied by
 * findDangerousKeys). The tree's props are plain data — `dangerouslySetInnerHTML`
 * and inline event handlers have no legitimate place in a cloud copy.
 */
const CLOUD_EXECUTION_KEYS = new Set([
  "dangerouslySetInnerHTML",
  "dangerouslySetInnerHTMLProps",
  "onload",
  "onerror",
  "onclick",
  "onmouseover",
  "onfocus",
]);

/** Recursively find cloud-execution keys at any depth. */
function findCloudExecutionKeys(payload: unknown, path = ""): string[] {
  const problems: string[] = [];
  if (payload === null || typeof payload !== "object") return problems;
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => {
      problems.push(...findCloudExecutionKeys(item, `${path}[${index}]`));
    });
    return problems;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (CLOUD_EXECUTION_KEYS.has(key)) {
      problems.push(`Unsafe key "${key}"${path ? ` at ${path}` : ""} is not allowed in a cloud copy.`);
      continue;
    }
    if (value !== null && typeof value === "object") {
      problems.push(...findCloudExecutionKeys(value, `${path}.${key}`));
    }
  }
  return problems;
}

function checkPayloadSize(payload: unknown): CloudSyncError | null {
  let bytes = 0;
  try {
    bytes = new Blob([JSON.stringify(payload)]).size;
  } catch {
    bytes = JSON.stringify(payload).length * 2;
  }
  if (bytes > CLOUD_MAX_PAYLOAD_BYTES) {
    return makeCloudSyncError(
      "REMOTE_VALIDATION_FAILED",
      "A cloud copy is too large to sync. Try syncing that saved piece again after trimming it.",
      `Payload size ${bytes} exceeds ${CLOUD_MAX_PAYLOAD_BYTES}.`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Local → Cloud
// ---------------------------------------------------------------------------

/**
 * Serialize a validated MyBlockRecord to a cloud payload. Local-only UI
 * fields are stripped. Returns a structured error when the record is not
 * valid (should not happen — records are validated at rest).
 */
export function myBlockToCloud(
  record: MyBlockRecord,
  options?: { deviceId?: string },
): { ok: true; payload: CloudMyBlockPayload } | { ok: false; error: CloudSyncError } {
  const parsed = parseMyBlockRecord(record);
  if (!parsed) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A saved piece could not be prepared for backup.",
      ),
    };
  }
  // The validated record type is looser than MyBlockRecord in a few fields
  // (category, previewMetadata) — cast to the strict native model like the
  // storage adapter does.
  const native = parsed as MyBlockRecord;
  const payload: CloudMyBlockPayload = {
    id: `cloud-${record.id}`, // provisional id; the provider assigns the server id
    schemaVersion: CLOUD_SCHEMA_VERSION,
    name: native.name,
    ...(native.description !== undefined ? { description: native.description } : {}),
    category: native.category,
    tags: native.tags,
    tree: native.tree as BlockTree,
    ...(native.sourceMetadata
      ? { sourceMetadata: native.sourceMetadata as MyBlockSourceMetadata }
      : {}),
    previewMetadata: native.previewMetadata,
    contentRevision: native.contentRevision ?? 1,
    createdAt: native.createdAt,
    updatedAt: native.updatedAt,
    clientUpdatedAt: native.updatedAt,
    ...(options?.deviceId ? { deviceId: options.deviceId } : {}),
    deletedAt: null,
  };

  const sizeError = checkPayloadSize(payload);
  if (sizeError) return { ok: false, error: sizeError };
  const validation = CloudMyBlockPayloadSchema.safeParse(payload);
  if (!validation.success) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A saved piece could not be prepared for backup.",
        validation.error.message,
      ),
    };
  }
  // The zod-inferred shape is looser than the strict contract (category,
  // previewMetadata) — cast after full validation, like parseCloud* does.
  return { ok: true, payload: validation.data as CloudMyBlockPayload };
}

/**
 * Serialize a validated MyBlockCollection to a cloud payload. Membership is
 * computed from the LOCAL block list (the local model stores membership on
 * blocks via collectionIds) and resolved through markers (local block ids →
 * cloud block ids). Unresolved memberships are skipped — they sync once
 * their blocks have markers.
 */
export function collectionToCloud(
  collection: MyBlockCollection,
  blocks: ReadonlyArray<MyBlockRecord>,
  markers: ReadonlyMap<string, CloudSyncMarker>,
): { ok: true; payload: CloudMyBlockCollectionPayload } | { ok: false; error: CloudSyncError } {
  const parsed = parseMyBlockCollection(collection);
  if (!parsed) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A collection could not be prepared for backup.",
      ),
    };
  }
  const blockIds: string[] = [];
  for (const block of blocks) {
    if (!block.collectionIds || !block.collectionIds.includes(collection.id)) continue;
    const cloudId = resolveCloudId(markers, "myBlock", block.id);
    if (cloudId && !blockIds.includes(cloudId)) {
      blockIds.push(cloudId);
    }
  }
  const payload: CloudMyBlockCollectionPayload = {
    id: `cloud-${collection.id}`,
    schemaVersion: CLOUD_SCHEMA_VERSION,
    name: parsed.name,
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    sortOrder: parsed.sortOrder,
    blockIds,
    deletedAt: null,
  };

  const sizeError = checkPayloadSize(payload);
  if (sizeError) return { ok: false, error: sizeError };
  const validation = CloudMyBlockCollectionPayloadSchema.safeParse(payload);
  if (!validation.success) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A collection could not be prepared for backup.",
        validation.error.message,
      ),
    };
  }
  return { ok: true, payload: validation.data as CloudMyBlockCollectionPayload };
}

// ---------------------------------------------------------------------------
// Cloud → Local (only ever called after schema validation)
// ---------------------------------------------------------------------------

export interface CloudToLocalBlockInput {
  /** Cloud payload already validated by the caller. */
  payload: CloudMyBlockPayload;
  /** Local id to use (fresh id for new downloads, existing for updates). */
  localId: string;
}

/**
 * Build a validated MyBlockRecord from a cloud payload. Local-only fields
 * are NOT copied from the cloud (thumbnail is regenerated locally, favorites
 * are per-device, usage counters are per-device).
 */
export function cloudToMyBlock(
  input: CloudToLocalBlockInput,
): { ok: true; record: MyBlockRecord } | { ok: false; error: CloudSyncError } {
  const { payload, localId } = input;
  const record: MyBlockRecord = {
    id: localId,
    version: 1,
    name: payload.name,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    category: payload.category as MyBlockRecord["category"],
    tags: payload.tags,
    tree: payload.tree,
    ...(payload.sourceMetadata
      ? { sourceMetadata: payload.sourceMetadata }
      : {}),
    previewMetadata: payload.previewMetadata,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    contentRevision: payload.contentRevision,
  };

  const parsed = parseMyBlockRecord(record);
  if (!parsed || parsed.tree.rootIds.length === 0) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A cloud copy could not be restored to this device.",
      ),
    };
  }
  return { ok: true, record: parsed as MyBlockRecord };
}

export interface CloudToLocalCollectionInput {
  payload: CloudMyBlockCollectionPayload;
  localId: string;
}

/** Build a validated MyBlockCollection from a cloud payload. */
export function cloudToMyBlockCollection(
  input: CloudToLocalCollectionInput,
): { ok: true; collection: MyBlockCollection } | { ok: false; error: CloudSyncError } {
  const { payload, localId } = input;
  const collection: MyBlockCollection = {
    id: localId,
    version: 1,
    name: payload.name,
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    sortOrder: payload.sortOrder,
  };
  const parsed = parseMyBlockCollection(collection);
  if (!parsed) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A cloud collection could not be restored to this device.",
      ),
    };
  }
  return { ok: true, collection: parsed as MyBlockCollection };
}

// ---------------------------------------------------------------------------
// Remote payload parsing (validate + reject dangerous keys + size caps)
// ---------------------------------------------------------------------------

export type RemoteParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CloudSyncError };

/**
 * Parse + fully validate a remote cloud block payload. Rejects dangerous
 * keys, unsupported versions, over-size payloads, and malformed trees.
 */
export function parseCloudMyBlockPayload(value: unknown): RemoteParseResult<CloudMyBlockPayload> {
  if (value === null || typeof value !== "object") {
    return { ok: false, error: makeCloudSyncError("REMOTE_VALIDATION_FAILED", "A cloud copy was unreadable.") };
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CLOUD_SCHEMA_VERSION) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "UNSUPPORTED_REMOTE_VERSION",
        "A cloud copy was made with a newer Buildora and can't be read on this device yet.",
        `schemaVersion ${String(raw.schemaVersion)} > ${CLOUD_SCHEMA_VERSION}.`,
      ),
    };
  }
  const dangerous = [...findDangerousKeys(value), ...findCloudExecutionKeys(value)];
  if (dangerous.length > 0) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A cloud copy contained unsafe data and was not applied.",
        dangerous[0],
      ),
    };
  }
  const sizeError = checkPayloadSize(value);
  if (sizeError) return { ok: false, error: sizeError };
  const result = CloudMyBlockPayloadSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A cloud copy could not be validated.",
        result.error.message,
      ),
    };
  }
  // The zod-inferred shape is looser than the strict CloudMyBlockPayload
  // contract (category/previewMetadata/tree) — cast after full validation.
  return { ok: true, value: result.data as CloudMyBlockPayload };
}

/** Parse + validate a remote cloud collection payload. */
export function parseCloudMyBlockCollectionPayload(
  value: unknown,
): RemoteParseResult<CloudMyBlockCollectionPayload> {
  if (value === null || typeof value !== "object") {
    return { ok: false, error: makeCloudSyncError("REMOTE_VALIDATION_FAILED", "A cloud collection was unreadable.") };
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > CLOUD_SCHEMA_VERSION) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "UNSUPPORTED_REMOTE_VERSION",
        "A cloud collection was made with a newer Buildora and can't be read on this device yet.",
      ),
    };
  }
  const dangerous = [...findDangerousKeys(value), ...findCloudExecutionKeys(value)];
  if (dangerous.length > 0) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A cloud collection contained unsafe data and was not applied.",
        dangerous[0],
      ),
    };
  }
  const sizeError = checkPayloadSize(value);
  if (sizeError) return { ok: false, error: sizeError };
  const result = CloudMyBlockCollectionPayloadSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      error: makeCloudSyncError(
        "REMOTE_VALIDATION_FAILED",
        "A cloud collection could not be validated.",
        result.error.message,
      ),
    };
  }
  return { ok: true, value: result.data as CloudMyBlockCollectionPayload };
}

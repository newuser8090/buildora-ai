// ---------------------------------------------------------------------------
// Persistence — constants for format versioning, import limits, and file types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Format version
// ---------------------------------------------------------------------------

/**
 * Current canonical format version for SerializedBuildoraProject envelopes.
 *
 * Version history:
 *   1 — Original projects (no formatVersion field). Assets field may be absent.
 *   2 — Added SerializedBuildoraProject envelope, formatVersion: 2, project.assets
 *       normalized to [].
 */
export const CURRENT_FORMAT_VERSION = 2;

// ---------------------------------------------------------------------------
// Import limits
//
// These are the DOCUMENTED Phase E transfer limits. The import service
// enforces the aggregate caps (pages 100, total sections 2000 across all
// pages, assets 2000) with structured errors that carry the limit name,
// the actual value, the maximum value, and the offending path.
// ---------------------------------------------------------------------------

/** Maximum size for an imported project file (10 MB). */
export const MAX_PROJECT_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum number of pages in a project. */
export const MAX_PAGES = 100;

/** Maximum sections per page (aggregate total across all pages is 2000). */
export const MAX_SECTIONS_PER_PAGE = 2000;

/** Maximum feature items. */
export const MAX_FEATURE_ITEMS = 50;

/** Maximum FAQ items. */
export const MAX_FAQ_ITEMS = 50;

/** Maximum assets. */
export const MAX_ASSETS = 2000;

/** Maximum supported structural nesting depth for imported JSON (root = 1). */
export const MAX_IMPORT_STRUCTURAL_DEPTH = 20;

/** Maximum asset name length. */
export const MAX_ASSET_NAME_LENGTH = 256;

/** Maximum individual data URL payload size before base64 decoding (5 MB). */
export const MAX_ASSET_PAYLOAD_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum common text-field length (headline, title, etc.). */
export const MAX_TEXT_FIELD_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Accepted file extensions for project import
// ---------------------------------------------------------------------------

/** Accepted extensions for Buildora project files. */
export const ACCEPTED_PROJECT_EXTENSIONS = [".buildora.json", ".json"];

/** Default filename for project file download. */
export const DEFAULT_PROJECT_FILENAME = "project.buildora.json";

// ---------------------------------------------------------------------------
// IndexedDB database constants
// ---------------------------------------------------------------------------

/** Database name for IndexedDB persistence. */
export const DATABASE_NAME = "buildora";

/**
 * Current database schema version.
 *
 * Version history:
 *   1 — projects + metadata stores.
 *   2 — added projectThumbnails store (binary Blob thumbnails, keyed by projectId).
 *   3 — added myBlocks store (Phase P4 personal block library).
 *   4 — added myBlockThumbnails + myBlockCollections stores (Phase P5 visual
 *       library: persistent block thumbnails and personal collections).
 *   5 — added cloudSyncQueue + cloudSyncMarkers + cloudSyncConflicts stores
 *       (Phase P6 cloud sync: durable offline queue, sync markers, and
 *       durable conflict records).
 *   6 — added deployments store (Phase P7 publishing: deployment history
 *       lives OUTSIDE ProjectSchema).
 *   7 — added deploymentDomains store (Phase P8 publishing: custom domain
 *       records live OUTSIDE ProjectSchema).
 *   8 — added personalTemplates store (Phase P9: saved personal templates,
 *       local-only) and recoverySnapshots store (Phase P9: bounded draft
 *       recovery history per project).
 */
export const DATABASE_VERSION = 8;

/** Object store for project records. */
export const STORE_PROJECTS = "projects";

/** Object store for key/value metadata. */
export const STORE_METADATA = "metadata";

/** Object store for project thumbnail Blob records (database version 2). */
export const STORE_PROJECT_THUMBNAILS = "projectThumbnails";

/** Object store for saved personal building blocks (database version 3, Phase P4). */
export const STORE_MY_BLOCKS = "myBlocks";

/** Object store for My Block thumbnail Blob records (database version 4, Phase P5). */
export const STORE_MY_BLOCK_THUMBNAILS = "myBlockThumbnails";

/** Object store for personal collections/folders (database version 4, Phase P5). */
export const STORE_MY_BLOCK_COLLECTIONS = "myBlockCollections";

/**
 * Durable offline sync queue (database version 5, Phase P6). Entries describe
 * the INTENT to sync an entity (never raw pasted source — payloads are read
 * fresh from the canonical local adapter at sync time).
 */
export const STORE_CLOUD_SYNC_QUEUE = "cloudSyncQueue";

/**
 * Per-record sync markers (database version 5, Phase P6). Map local entity
 * ids to cloud ids and record the last-synced revision so conflicts can be
 * detected without relying on wall-clock timestamps alone.
 */
export const STORE_CLOUD_SYNC_MARKERS = "cloudSyncMarkers";

/**
 * Durable conflict records (database version 5, Phase P6). Decisions must
 * survive reloads and be retry-safe, so open/resolved conflicts live in
 * IndexedDB rather than memory.
 */
export const STORE_CLOUD_SYNC_CONFLICTS = "cloudSyncConflicts";

/**
 * Deployment history (database version 6, Phase P7). Deployment records are
 * operational history and stay OUTSIDE ProjectSchema. No tokens or provider
 * secrets are ever stored here.
 */
export const STORE_DEPLOYMENTS = "deployments";

/**
 * Custom domain records (database version 7, Phase P8). Domains are
 * deployment infrastructure, not site content — stored OUTSIDE ProjectSchema.
 * The provider is the remote source of truth; this store is local history.
 */
export const STORE_DEPLOYMENT_DOMAINS = "deploymentDomains";

/**
 * Saved personal templates (database version 8, Phase P9). Local-only in P9;
 * stores deep-cloned Project snapshots with template metadata. No deployment,
 * domain, sync, or auth state is ever stored here.
 */
export const STORE_PERSONAL_TEMPLATES = "personalTemplates";

/**
 * Draft recovery snapshots (database version 8, Phase P9). Bounded per
 * project (see MAX_RECOVERY_SNAPSHOTS_PER_PROJECT) — last-known-good copies
 * taken after successful saves so a corrupted write can be recovered.
 */
export const STORE_RECOVERY_SNAPSHOTS = "recoverySnapshots";

/** Key for the active project ID in the metadata store. */
export const METADATA_KEY_ACTIVE_PROJECT = "activeProjectId";

/** Key for the stable, non-identifying device id in the metadata store. */
export const METADATA_KEY_DEVICE_ID = "deviceId";

/**
 * Prefix for per-user sync cursors in the metadata store.
 * Full key: `${METADATA_KEY_SYNC_CURSOR_PREFIX}${userId}`.
 */
export const METADATA_KEY_SYNC_CURSOR_PREFIX = "cloudSyncCursor:";

/** Key for the per-user initial-merge decision in the metadata store. */
export const METADATA_KEY_INITIAL_MERGE_PREFIX = "cloudInitialMerge:";

// ---------------------------------------------------------------------------
// Autosave defaults
// ---------------------------------------------------------------------------

/** Default debounce interval for autosave (ms). */
export const AUTOSAVE_DEBOUNCE_MS = 3000;

/** Default initial revision for new project records. */
export const INITIAL_REVISION = 1;

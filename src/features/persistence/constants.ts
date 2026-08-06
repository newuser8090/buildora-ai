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
 */
export const DATABASE_VERSION = 4;

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

/** Key for the active project ID in the metadata store. */
export const METADATA_KEY_ACTIVE_PROJECT = "activeProjectId";

// ---------------------------------------------------------------------------
// Autosave defaults
// ---------------------------------------------------------------------------

/** Default debounce interval for autosave (ms). */
export const AUTOSAVE_DEBOUNCE_MS = 3000;

/** Default initial revision for new project records. */
export const INITIAL_REVISION = 1;

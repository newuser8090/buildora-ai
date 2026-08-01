// ---------------------------------------------------------------------------
// Thumbnails — centralized constants
//
// All magic numbers for thumbnail generation live here. Do not scatter them
// across components or services.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Capture source viewport (the read-only preview is rendered at this size)
// ---------------------------------------------------------------------------

/** Source viewport width used when rendering the hidden preview. */
export const THUMBNAIL_SOURCE_WIDTH = 1440;

/** Source viewport height used when rendering the hidden preview. */
export const THUMBNAIL_SOURCE_HEIGHT = 900;

// ---------------------------------------------------------------------------
// Output thumbnail dimensions (16:10 aspect ratio, matching 1440x900)
// ---------------------------------------------------------------------------

/** Output thumbnail width. */
export const THUMBNAIL_OUTPUT_WIDTH = 480;

/** Output thumbnail height. */
export const THUMBNAIL_OUTPUT_HEIGHT = 300;

// ---------------------------------------------------------------------------
// Encoding policy
// ---------------------------------------------------------------------------

/** Preferred output MIME type. */
export const THUMBNAIL_MIME_PREFERENCE = "image/webp";

/** Fallback MIME type when the browser does not support WebP encoding. */
export const THUMBNAIL_MIME_FALLBACK = "image/png";

/** Encoding quality for lossy formats (0.8–0.85 per Phase G spec). */
export const THUMBNAIL_QUALITY = 0.82;

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** Overall timeout for rendering + readiness + capture (ms). */
export const THUMBNAIL_RENDER_TIMEOUT_MS = 10_000;

/** Timeout for waiting on fonts / referenced images to load (ms). */
export const THUMBNAIL_ASSET_WAIT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/** Debounce after a successful persisted save before generation (ms). */
export const THUMBNAIL_DEBOUNCE_MS = 2000;

// ---------------------------------------------------------------------------
// Dashboard eventual-thumbnail policy (Phase G §3)
//
// The dashboard must handle a thumbnail that is still being generated when the
// user returns from the editor. Primary path: the scheduler publishes a ready
// notification ONLY after the IndexedDB write transaction commits, and the
// dashboard hook reloads that single project. Race resilience: a bounded
// exponential retry covers the (rare) window where a completion notification
// is missed. The retry is bounded — never permanent polling.
// ---------------------------------------------------------------------------

/** Base delay for the dashboard's bounded missing-thumbnail retry (ms). */
export const THUMBNAIL_RETRY_BASE_DELAY_MS = 500;

/**
 * Maximum retry attempts per missing thumbnail (exponential backoff).
 * Total worst-case window ≈ 500+1000+2000+4000 = 7.5s, comfortably covering
 * debounce (2s) + render/capture/encode + commit. Retries stop after this.
 */
export const THUMBNAIL_RETRY_MAX_ATTEMPTS = 4;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Object store name for project thumbnails (added in database version 2). */
export const STORE_PROJECT_THUMBNAILS = "projectThumbnails";

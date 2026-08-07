// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — tunables and limits
//
// Bounded queues, bounded backoff, bounded batches, payload caps. Keeping the
// constants here makes the sync engine testable with deterministic timers.
// ---------------------------------------------------------------------------

/** Current cloud payload schema version (also re-exported by ./types). */
export const CLOUD_SCHEMA_VERSION = 1;

/** Maximum number of queued ops uploaded per sync run. */
export const SYNC_UPLOAD_BATCH_SIZE = 50;

/** Maximum number of remote delta records applied per sync run. */
export const SYNC_DOWNLOAD_BATCH_SIZE = 200;

/** Base backoff delay (ms) before the first retry of a failed queue entry. */
export const SYNC_RETRY_BASE_DELAY_MS = 2000;

/** Maximum backoff delay (ms) for a queue entry. */
export const SYNC_RETRY_MAX_DELAY_MS = 10 * 60 * 1000;

/** Maximum retry count before an entry needs user attention (stays queued). */
export const SYNC_MAX_RETRY_COUNT = 12;

/** Debounce window for metadata changes before a sync is scheduled (ms). */
export const SYNC_CHANGE_DEBOUNCE_MS = 4000;

/** Periodic low-frequency sync while signed in and active (ms). */
export const SYNC_PERIODIC_INTERVAL_MS = 60 * 1000;

/** Maximum number of open conflicts rendered at once. */
export const SYNC_MAX_CONFLICTS_RENDERED = 50;

/** Queue hard cap — beyond this, new entries are still accepted but the UI warns. */
export const SYNC_QUEUE_SOFT_CAP = 1000;

/** Maximum JSON payload size for one cloud record (1 MB). */
export const CLOUD_MAX_PAYLOAD_BYTES = 1024 * 1024;

/** Maximum JSON payload size for one batch of records (4 MB). */
export const CLOUD_MAX_BATCH_BYTES = 4 * 1024 * 1024;

/** Invitation lifetime (days). */
export const INVITATION_TTL_DAYS = 14;

/** Tombstones (soft-deleted rows) are retained for this many days server-side. */
export const TOMBSTONE_RETENTION_DAYS = 30;

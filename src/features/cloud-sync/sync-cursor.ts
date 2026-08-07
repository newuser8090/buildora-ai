// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — deterministic delta cursors
//
// A sync cursor is an opaque string of the form `<updatedAt>|<entityId>`
// where entityId is the cloud record id (stable per record). Providers and
// the engine use these helpers so:
//   - records updated AFTER the cursor's timestamp are always returned
//   - records updated at the SAME timestamp as the cursor are returned only
//     when their stable id sorts AFTER the cursor's id (deterministic,
//     loss-free tie-break — equal-timestamp records are never skipped)
//   - the cursor only ever advances to a record that was actually observed
//     in a returned page (never fabricated, never ahead of the data)
// ---------------------------------------------------------------------------

export const SYNC_CURSOR_EPOCH = "1970-01-01T00:00:00.000Z";

export interface SyncCursorPosition {
  /** ISO updatedAt of the last observed record. */
  ts: string;
  /** Stable cloud entity id of the last observed record. */
  id: string;
}

const EMPTY_POSITION: SyncCursorPosition = { ts: SYNC_CURSOR_EPOCH, id: "" };

/** Parse an opaque cursor string into a position (safe for any input). */
export function parseSyncCursor(cursor: string | null | undefined): SyncCursorPosition {
  if (!cursor) return { ...EMPTY_POSITION };
  const [ts, ...rest] = cursor.split("|");
  const id = rest.join("|");
  return {
    ts: ts && ts.length > 0 ? ts : SYNC_CURSOR_EPOCH,
    id: id ?? "",
  };
}

/** Encode a position as the opaque cursor string. */
export function encodeSyncCursor(ts: string, id: string): string {
  return `${ts}|${id}`;
}

/** Sort key comparison: `updatedAt` first, stable id as the tie-breaker. */
export function compareSyncRecords(a: { ts: string; id: string }, b: { ts: string; id: string }): number {
  return a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id);
}

/**
 * True when a record belongs AFTER the cursor position. Records at the exact
 * same timestamp are ordered by stable id, so pagination never skips or
 * re-sends equal-timestamp records.
 */
export function isRecordAfterCursor(
  recordTs: string,
  recordId: string,
  cursor: SyncCursorPosition,
): boolean {
  const tsCmp = recordTs.localeCompare(cursor.ts);
  if (tsCmp > 0) return true;
  if (tsCmp < 0) return false;
  // Same timestamp → stable id tie-break (strictly greater id = unseen).
  return recordId > cursor.id;
}

/**
 * The maximum position among the records of a page — the only legitimate
 * next cursor. Returns null when the page is empty (callers must NOT advance
 * the cursor past records they never observed).
 */
export function maxPagePosition(
  records: ReadonlyArray<{ ts: string; id: string }>,
): SyncCursorPosition | null {
  let max: SyncCursorPosition | null = null;
  for (const record of records) {
    if (!max || compareSyncRecords(record, max) > 0) {
      max = { ts: record.ts, id: record.id };
    }
  }
  return max;
}

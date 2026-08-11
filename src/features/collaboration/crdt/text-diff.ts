// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — minimal text diff
//
// Computes a minimal {delete, insert} pair between two strings that Y.Text can
// apply as character-level operations. Because Yjs merges Y.Text operations by
// position (YATA), two concurrent edits to the same field both survive instead
// of last-write-wins:
//
//   "Hello world" → A inserts "beautiful " at 6, B inserts "!" at 11
//   ⇒ converged "Hello beautiful world!" (deterministic).
//
// The diff is a common-prefix/suffix extraction with a single middle replace —
// this covers typing, backspace, paste, and whole-value commits with minimal
// operations, which is all real editors produce per transaction.
// ---------------------------------------------------------------------------

export interface TextDiffOp {
  /** Start index in the OLD string where the delete begins. */
  deleteIndex: number;
  /** Number of characters removed from the old string. */
  deleteLength: number;
  /** Start index in the NEW string where the insert lands. */
  insertIndex: number;
  /** Characters to insert (after the delete). */
  insertText: string;
}

/** True when the diff is a no-op (strings already equal). */
export function isTextDiffNoop(op: TextDiffOp): boolean {
  return op.deleteLength === 0 && op.insertText.length === 0;
}

/**
 * Compute the minimal middle-replace diff from `oldValue` to `newValue`.
 * Always returns a valid op; `isTextDiffNoop` distinguishes no-ops.
 */
export function diffText(oldValue: string, newValue: string): TextDiffOp {
  // Common prefix
  let prefix = 0;
  const maxPrefix = Math.min(oldValue.length, newValue.length);
  while (
    prefix < maxPrefix &&
    oldValue.charCodeAt(prefix) === newValue.charCodeAt(prefix)
  ) {
    prefix += 1;
  }

  // Common suffix (excluding the shared prefix)
  let suffix = 0;
  const oldTail = oldValue.length - prefix;
  const newTail = newValue.length - prefix;
  const maxSuffix = Math.min(oldTail, newTail);
  while (
    suffix < maxSuffix &&
    oldValue.charCodeAt(oldValue.length - 1 - suffix) ===
      newValue.charCodeAt(newValue.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  return {
    deleteIndex: prefix,
    deleteLength: oldValue.length - prefix - suffix,
    insertIndex: prefix,
    insertText: newValue.slice(prefix, newValue.length - suffix),
  };
}

/**
 * Apply a diff op to a Y.Text (imported lazily to keep this module pure).
 * Deletes then inserts within the same transaction (the caller owns the
 * transaction), which is how Yjs merges concurrent text edits.
 */
export function applyTextDiffToYText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ytext: any,
  op: TextDiffOp,
): void {
  if (isTextDiffNoop(op)) return;
  if (op.deleteLength > 0) {
    ytext.delete(op.deleteIndex, op.deleteLength);
  }
  if (op.insertText.length > 0) {
    ytext.insert(op.insertIndex, op.insertText);
  }
}

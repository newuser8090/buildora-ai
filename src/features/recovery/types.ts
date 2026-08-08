// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — types
//
// Recovery snapshots are last-known-good Project copies captured after
// successful saves. They are bounded per project and never overwrite the
// live project without explicit confirmation.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

export interface RecoverySnapshot {
  /** Unique snapshot id: "snap-<projectId>-<timestamp>". */
  id: string;
  projectId: string;
  /** Project revision this snapshot represents. */
  revision: number;
  createdAt: string;
  /** Why the snapshot was captured: "autosave" | "manual" | "open". */
  reason: string;
  /** Deep-cloned, validated Project. */
  project: Project;
}

export type RecoveryErrorCode =
  | "RECOVERY_NOT_FOUND"
  | "RECOVERY_SNAPSHOT_INVALID"
  | "RECOVERY_STORE_UNAVAILABLE"
  | "RECOVERY_UNKNOWN_ERROR";

export interface RecoveryError {
  code: RecoveryErrorCode;
  message: string;
  cause?: string;
}

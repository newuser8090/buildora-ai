"use client";

// ---------------------------------------------------------------------------
// Phase P15 — WorkspaceHistoryDialogs
//
// Mounts the version-history dialog cluster in the editor. Only renders when
// the UI store is open (each dialog gates itself), so the history surface has
// zero cost on the editing hot path. Also holds the presence session while a
// workspace project is open (joined on open, left on unmount/switch).
// ---------------------------------------------------------------------------

import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { VersionPreviewDialog } from "./VersionPreviewDialog";
import { RestoreVersionDialog } from "./RestoreVersionDialog";
import { CopyVersionDialog } from "./CopyVersionDialog";

export function WorkspaceHistoryDialogs() {
  return (
    <>
      <VersionHistoryDialog />
      <VersionPreviewDialog />
      <RestoreVersionDialog />
      <CopyVersionDialog />
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase P15 — version reason → human label (shared by history + restore UI)
// ---------------------------------------------------------------------------

import type { ProjectVersionMeta, ProjectVersionReason } from "../types";

export function reasonLabel(version: ProjectVersionMeta): string {
  switch (version.reason as ProjectVersionReason) {
    case "autosave":
      return "Saved changes";
    case "publish":
      return "Published";
    case "checkpoint":
      return version.label ? `Manual checkpoint — ${version.label}` : "Manual checkpoint";
    case "pre-restore":
      return version.label ?? "Before restoring";
    case "restore":
      return version.label ?? "Restored from an older version";
    default:
      return "Saved changes";
  }
}

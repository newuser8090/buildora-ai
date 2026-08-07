// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — types
//
// A shared library is a private, named box of saved pieces owned by one
// user. Members can preview pieces and copy them into their own personal My
// Blocks (fresh independent ids). No public discovery — everything is
// private by default and enforced server-side.
// ---------------------------------------------------------------------------

import type {
  CloudLibraryInvitation,
  CloudSharedLibrary,
  CloudSharedLibraryBlock,
  CloudSyncError,
  SharedLibraryRole,
} from "@/features/cloud-sync/types";

export type { CloudLibraryInvitation, CloudSharedLibrary, CloudSharedLibraryBlock, SharedLibraryRole };

export type SharedLibraryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CloudSyncError };

export interface SharedLibrariesListing {
  owned: CloudSharedLibrary[];
  shared: CloudSharedLibrary[];
}

/** Map a server role to a beginner label. */
export function roleLabel(role: "owner" | SharedLibraryRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "editor":
      return "Can edit";
    case "viewer":
      return "Can view";
  }
}

/** Beginner copy used across the shared-library UI. */
export const SHARED_LIBRARY_TAGLINE = "Share a private box of saved pieces.";

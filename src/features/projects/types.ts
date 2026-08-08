// ---------------------------------------------------------------------------
// Project Dashboard types
// ---------------------------------------------------------------------------

import type { PersistenceError } from "@/features/persistence/types";

// ---------------------------------------------------------------------------
// Dashboard project model (extends adapter's ProjectSummary with UI state)
// ---------------------------------------------------------------------------

export interface DashboardProject {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  isActive: boolean;
  isPinned: boolean;
  /** Phase P9 — archived projects are hidden from the main grid. */
  isArchived?: boolean;
  /** Runtime object URL for the project thumbnail (never persisted). */
  thumbnailUrl?: string | null;
  /** Thumbnail status for the card UI. */
  thumbnailStatus?: "missing" | "loading" | "ready" | "stale" | "error";
  /** Revision the current thumbnail represents. */
  thumbnailRevision?: number | null;
  pageCount: number;
  assetCount: number;
}

// ---------------------------------------------------------------------------
// Sort modes
// ---------------------------------------------------------------------------

export type ProjectSortMode =
  | "last-edited"
  | "recently-created"
  | "name-asc"
  | "name-desc";

// ---------------------------------------------------------------------------
// Dashboard error codes
// ---------------------------------------------------------------------------

export type ProjectDashboardErrorCode =
  | "PROJECT_LIST_FAILED"
  | "PROJECT_CREATE_FAILED"
  | "PROJECT_OPEN_FAILED"
  | "PROJECT_RENAME_FAILED"
  | "PROJECT_DUPLICATE_FAILED"
  | "PROJECT_DELETE_FAILED"
  | "PROJECT_PIN_FAILED"
  | "PROJECT_ARCHIVE_FAILED"
  | "SAVE_BEFORE_TRANSITION_FAILED"
  | "PROJECT_NOT_FOUND"
  | "INVALID_PROJECT_NAME"
  | "TRANSITION_IN_PROGRESS";

export interface ProjectDashboardError {
  code: ProjectDashboardErrorCode;
  message: string;
  retryable?: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard operation state
// ---------------------------------------------------------------------------

export type DashboardOperation =
  | null
  | {
      type: "creating" | "opening" | "renaming" | "duplicating" | "deleting" | "pinning" | "archiving";
      projectId?: string;
    }
  | { type: "importing"; token: number }
  | { type: "exporting"; projectId: string; token: number };

// ---------------------------------------------------------------------------
// Dashboard state
// ---------------------------------------------------------------------------

export interface ProjectsDashboardState {
  projects: DashboardProject[];
  filteredProjects: DashboardProject[];
  isLoading: boolean;
  isRefreshing: boolean;
  operation: DashboardOperation;
  searchQuery: string;
  sortMode: ProjectSortMode;
  /** Phase P9 — archived view is a separate list; the main grid hides them. */
  showArchived: boolean;
  error: ProjectDashboardError | null;
}

// ---------------------------------------------------------------------------
// Pin metadata
// ---------------------------------------------------------------------------

export interface ProjectPinMetadata {
  projectId: string;
  isPinned: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mapPersistenceErrorToDashboard(
  error: PersistenceError,
): ProjectDashboardError {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return { code: "PROJECT_NOT_FOUND", message: "Project was not found.", retryable: false };
    case "QUOTA_EXCEEDED":
      return { code: "PROJECT_CREATE_FAILED", message: "Storage is full. Free up space to create more projects.", retryable: true };
    case "INDEXED_DB_UNAVAILABLE":
      return { code: "PROJECT_LIST_FAILED", message: "Local storage is not available.", retryable: false };
    default:
      return { code: "PROJECT_LIST_FAILED", message: error.message, retryable: error.retryable ?? true };
  }
}

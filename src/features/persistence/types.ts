// ---------------------------------------------------------------------------
// Persistence — shared types for project serialization, migration, and storage
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Serialized envelope — wraps the editable project with format metadata
// ---------------------------------------------------------------------------

export interface SerializedBuildoraProject {
  /** Canonical format version. Current version: see CURRENT_FORMAT_VERSION. */
  formatVersion: number;
  /** Optional human-readable application version for informational display. */
  appVersion?: string;
  /** ISO timestamp of when this file was exported/downloaded. */
  exportedAt?: string;
  /** The complete editable project payload. */
  project: Project;
}

// ---------------------------------------------------------------------------
// Structured error model — stable error codes for expected failure paths
// ---------------------------------------------------------------------------

export interface ProjectFileError {
  code: ProjectFileErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Optional field or path information for precise error location. */
  field?: string;
  /** Internal-only technical detail (not displayed to users). */
  cause?: string;
  /**
   * Structured details for limit violations: limit name, actual value,
   * maximum value, and the offending path where available.
   */
  details?: {
    limit: string;
    actual?: number | string;
    max?: number;
    path?: string;
  };
}

export type ProjectFileErrorCode =
  | "INVALID_JSON"
  | "INVALID_ENVELOPE"
  | "INVALID_FORMAT_VERSION"
  | "UNSUPPORTED_FUTURE_VERSION"
  | "MIGRATION_FAILED"
  | "PROJECT_VALIDATION_FAILED"
  | "INVALID_ASSET"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_EXTENSION"
  | "UNSUPPORTED_FILE_TYPE";

// ---------------------------------------------------------------------------
// Warning model — non-blocking issues surfaced to the user
// ---------------------------------------------------------------------------

export interface ProjectFileWarning {
  code: string;
  message: string;
  field?: string;
}

// ---------------------------------------------------------------------------
// Deserialization result — structured success or structured failure
// ---------------------------------------------------------------------------

export type ProjectDeserializationResult =
  | {
      success: true;
      project: Project;
      formatVersion: number;
      migrationsApplied: string[];
      warnings: ProjectFileWarning[];
    }
  | {
      success: false;
      error: ProjectFileError;
    };

// ---------------------------------------------------------------------------
// Migration types
// ---------------------------------------------------------------------------

export type ProjectMigration = (input: unknown) => unknown;

// ---------------------------------------------------------------------------
// Normalization result
// ---------------------------------------------------------------------------

export type ProjectNormalizationResult =
  | {
      success: true;
      project: Project;
      warnings: ProjectFileWarning[];
    }
  | {
      success: false;
      error: ProjectFileError;
    };

// ---------------------------------------------------------------------------
// Migration result — internal pipeline output
// ---------------------------------------------------------------------------

export interface MigrationResult {
  /** Migrated data. Present only when the migration succeeded. */
  data: unknown;
  /** Names of migrations that were applied, e.g. [\"v1→v2\"]. Empty when no migration was needed. */
  applied: string[];
  /** Non-blocking warnings collected during migration. */
  warnings: ProjectFileWarning[];
  /** Structured error if the migration could not complete. When present, `data` must not be used. */
  error?: ProjectFileError;
}

// ---------------------------------------------------------------------------
// Persistence adapter types
// ---------------------------------------------------------------------------

/** Error codes for persistence operations. */
export type PersistenceErrorCode =
  | "INDEXED_DB_UNAVAILABLE"
  | "DATABASE_OPEN_FAILED"
  | "DATABASE_BLOCKED"
  | "TRANSACTION_FAILED"
  | "SERIALIZATION_FAILED"
  | "DESERIALIZATION_FAILED"
  | "QUOTA_EXCEEDED"
  | "PROJECT_NOT_FOUND"
  | "STALE_REVISION"
  | "ACTIVE_PROJECT_FAILED"
  | "UNKNOWN_PERSISTENCE_ERROR"
  | "INVALID_PROJECT_NAME";

/** Structured persistence error. */
export interface PersistenceError {
  code: PersistenceErrorCode;
  message: string;
  projectId?: string;
  cause?: string;
  retryable?: boolean;
}

/** Result for load operations. */
export type ProjectLoadResult =
  | { success: true; project: Project; revision: number; savedAt: string }
  | { success: false; error: PersistenceError };

/** Result for save operations. */
export type SaveProjectResult =
  | { success: true; revision: number; savedAt?: string }
  | { success: false; error: PersistenceError };

// ---------------------------------------------------------------------------
// Project transition result — used by ProjectController for lifecycle safety
// ---------------------------------------------------------------------------

/**
 * Structured result for project lifecycle transitions (create, open, switch,
 * delete, shutdown). Prevents silent loss of unsaved edits.
 */
export type ProjectTransitionResult<T = void> =
  | { success: true; data?: T }
  | { success: false;
      code:
        | "SAVE_BEFORE_TRANSITION_FAILED"
        | "PROJECT_LOAD_FAILED"
        | "PROJECT_CREATE_FAILED"
        | "PROJECT_DELETE_FAILED"
        | "ACTIVE_PROJECT_UPDATE_FAILED"
        | "CONTROLLER_NOT_INITIALIZED"
        | "TRANSITION_IN_PROGRESS";
      error?: PersistenceError;
    };

/** Generic persistence result. */
export type ProjectPersistenceResult =
  | { success: true }
  | { success: false; error: PersistenceError };

/** Result for active project ID lookup. */
export type ActiveProjectResult =
  | { success: true; projectId: string | null }
  | { success: false; error: PersistenceError };

/** Summary of a stored project (lightweight, no assets). */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  savedAt: string;
  revision: number;
  pageCount: number;
  assetCount: number;
  approximateAssetBytes: number;
}

/** Result for project listing. */
export type ProjectSummaryResult =
  | { success: true; projects: ProjectSummary[] }
  | { success: false; error: PersistenceError };

/** Storage estimate result. */
export interface StorageEstimateInfo {
  available: boolean;
  usage?: number;
  quota?: number;
  estimatedRemaining?: number;
}

export type StorageEstimateResult =
  | { success: true; estimate: StorageEstimateInfo }
  | { success: false; error: PersistenceError };

/** Request object for saving a project. */
export interface SaveProjectRequest {
  project: Project;
  revision: number;
  appVersion?: string;
}

/** Stored record inside IndexedDB. */
export interface StoredProjectRecord {
  id: string;
  revision: number;
  createdAt: string;
  savedAt: string;
  updatedAt: string;
  /** Parsed serialized envelope (not a JSON string). */
  envelope: SerializedBuildoraProject;
  /** Cached summary fields for fast listing. */
  name: string;
  pageCount: number;
  assetCount: number;
  approximateAssetBytes: number;
}

// ---------------------------------------------------------------------------
// Persistence adapter interface
// ---------------------------------------------------------------------------

export interface ProjectPersistenceAdapter {
  loadProject(projectId: string): Promise<ProjectLoadResult>;
  saveProject(request: SaveProjectRequest): Promise<SaveProjectResult>;
  removeProject(projectId: string): Promise<ProjectPersistenceResult>;
  listProjects(): Promise<ProjectSummaryResult>;
  getActiveProjectId(): Promise<ActiveProjectResult>;
  setActiveProjectId(projectId: string | null): Promise<ProjectPersistenceResult>;
  /** Get dashboard metadata for a project (e.g. pin state). */
  getDashboardMetadata(projectId: string): Promise<{ success: true; metadata: Record<string, unknown> } | { success: false; error: PersistenceError }>;
  /** Set dashboard metadata for a project (e.g. pin state). */
  setDashboardMetadata(projectId: string, metadata: Record<string, unknown>): Promise<ProjectPersistenceResult>;
  /** Remove dashboard metadata when a project is deleted. */
  removeDashboardMetadata(projectId: string): Promise<ProjectPersistenceResult>;
  estimateUsage(): Promise<StorageEstimateResult>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Autosave types
// ---------------------------------------------------------------------------

export interface AutosaveRequest {
  project: Project;
  projectId: string;
  revision: number;
}

/**
 * Enriched autosave state with revision tracking.
 *
 * - saved means the highest scheduled revision is persisted.
 * - unsaved means a newer required revision exists.
 * - saving exposes the exact in-flight revision.
 * - error remains associated with the latest required revision.
 *
 * Returned as an immutable snapshot — external callers cannot mutate internal state.
 */
export interface AutosaveState {
  status: "idle" | "unsaved" | "saving" | "saved" | "error";
  projectId: string;
  highestScheduledRevision: number | null;
  currentlySavingRevision: number | null;
  lastSuccessfullySavedRevision: number | null;
  pendingRevision: number | null;
  error?: PersistenceError;
}

/**
 * Result of calling schedule() on the autosave coordinator.
 *
 * - accepted: true means the request was accepted for persistence.
 * - accepted: false means the request was rejected — caller should
 *   flush/cancel and create a new coordinator for the correct project.
 */
export type AutosaveScheduleResult =
  | { accepted: true; revision: number }
  | {
      accepted: false;
      code: "PROJECT_SCOPE_MISMATCH";
      expectedProjectId: string;
      receivedProjectId: string;
    };

export type AutosaveListener = (state: AutosaveState) => void;

export type AutosaveResult =
  | { success: true; savedAt?: string }
  | { success: false; error: PersistenceError };

export interface AutosaveCoordinator {
  schedule(request: AutosaveRequest): AutosaveScheduleResult;
  flush(): Promise<AutosaveResult>;
  cancel(): void;
  dispose(): void;
  getState(): AutosaveState;
  subscribe(listener: AutosaveListener): () => void;
}

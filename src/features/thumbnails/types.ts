// ---------------------------------------------------------------------------
// Thumbnails — shared data model
//
// Thumbnails are stored SEPARATELY from editable Project data:
//   - never inside ProjectSchema
//   - never inside project serialization
//   - never inside the website export ZIP or .buildora.json export
//   - object URLs exist only in UI/runtime, never persisted
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status model
// ---------------------------------------------------------------------------

export type ProjectThumbnailStatus =
  | "missing"
  | "queued"
  | "rendering"
  | "ready"
  | "error"
  | "stale";

// ---------------------------------------------------------------------------
// Persisted record (IndexedDB blob)
// ---------------------------------------------------------------------------

export interface ProjectThumbnailRecord {
  /** Owning project ID (also the IndexedDB key). */
  projectId: string;
  /** Source project revision this thumbnail represents. */
  revision: number;
  /** ISO timestamp of generation (persistence metadata). */
  generatedAt: string;
  /** Output MIME type — "image/webp" preferred, "image/png" fallback. */
  mimeType: "image/webp" | "image/png";
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
  /** Encoded byte size. */
  byteSize: number;
  /** Binary image data — never base64 JSON. */
  data: Blob;
}

// ---------------------------------------------------------------------------
// Lightweight metadata (no Blob) — used by dashboards
// ---------------------------------------------------------------------------

export interface ProjectThumbnailMetadata {
  projectId: string;
  revision: number;
  generatedAt: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

// ---------------------------------------------------------------------------
// UI/runtime summary
// ---------------------------------------------------------------------------

export interface ProjectThumbnailSummary {
  projectId: string;
  revision: number;
  status: ProjectThumbnailStatus;
  generatedAt?: string;
  /** Runtime-only object URL. Never persisted. */
  objectUrl?: string;
  error?: ThumbnailError;
}

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

export type ThumbnailErrorCode =
  | "RENDER_TARGET_UNAVAILABLE"
  | "RENDER_FAILED"
  | "ENCODING_UNSUPPORTED"
  | "ENCODING_FAILED"
  | "CANVAS_TAINTED"
  | "IMAGE_LOAD_FAILED"
  | "STORAGE_FAILED"
  | "STALE_REVISION"
  | "PROJECT_NOT_FOUND"
  | "GENERATION_CANCELLED"
  | "UNKNOWN_THUMBNAIL_ERROR";

export interface ThumbnailError {
  code: ThumbnailErrorCode;
  /** User-safe message — never a raw stack trace. */
  message: string;
  projectId?: string;
  revision?: number;
  /** Whether retrying the same request may succeed. */
  retryable?: boolean;
  /** Technical detail for diagnostics (never shown verbatim in the UI). */
  cause?: string;
}

// ---------------------------------------------------------------------------
// Storage adapter results
// ---------------------------------------------------------------------------

export type ThumbnailLoadResult =
  | { success: true; record: ProjectThumbnailRecord }
  | { success: false; error: ThumbnailError };

export type ThumbnailSaveResult =
  | { success: true; record: ProjectThumbnailRecord; deduplicated: boolean }
  | { success: false; error: ThumbnailError };

export type ThumbnailResult =
  | { success: true }
  | { success: false; error: ThumbnailError };

export type ThumbnailMetadataListResult =
  | { success: true; items: ProjectThumbnailMetadata[] }
  | { success: false; error: ThumbnailError };

export type ThumbnailUsageResult =
  | { success: true; count: number; bytes: number }
  | { success: false; error: ThumbnailError };

// ---------------------------------------------------------------------------
// Storage adapter interface
// ---------------------------------------------------------------------------

export interface ProjectThumbnailStorageAdapter {
  getThumbnail(projectId: string): Promise<ThumbnailLoadResult>;
  saveThumbnail(record: ProjectThumbnailRecord): Promise<ThumbnailSaveResult>;
  removeThumbnail(projectId: string): Promise<ThumbnailResult>;
  listThumbnailMetadata?(): Promise<ThumbnailMetadataListResult>;
  estimateThumbnailUsage?(): Promise<ThumbnailUsageResult>;
  close(): void;
}

// ---------------------------------------------------------------------------
// Generation results
// ---------------------------------------------------------------------------

export interface GenerateThumbnailRequest {
  project: import("@/types/project").Project;
  revision: number;
}

export type GenerateThumbnailResult =
  | { ok: true; record: ProjectThumbnailRecord }
  | { ok: false; error: ThumbnailError };

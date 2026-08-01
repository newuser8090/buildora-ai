// ---------------------------------------------------------------------------
// ThumbnailDashboardService
//
// Dashboard-facing read path:
//   1. listThumbnailMetadata() — lightweight (no Blobs), all projects
//   2. loadThumbnailBlob(projectId) — one Blob for a visible card
//
// The dashboard renders cards with placeholders FIRST, then lazily upgrades
// cards to real thumbnails. Object URLs are managed by the UI hook, never
// persisted here.
//
// Scaling note: metadata is a single cheap read; Blobs are loaded per card on
// demand. For very large dashboards this can be refined with an
// IntersectionObserver, but per-card lazy loads keep first paint fast today.
// ---------------------------------------------------------------------------

import type {
  ProjectThumbnailMetadata,
  ProjectThumbnailRecord,
  ProjectThumbnailStorageAdapter,
  ThumbnailLoadResult,
  ThumbnailMetadataListResult,
} from "../types";

export class ThumbnailDashboardService {
  private storage: ProjectThumbnailStorageAdapter;

  constructor(storage: ProjectThumbnailStorageAdapter) {
    this.storage = storage;
  }

  /** Lightweight metadata for all projects (no Blobs). */
  async listMetadata(): Promise<ThumbnailMetadataListResult> {
    if (!this.storage.listThumbnailMetadata) {
      return { success: false, error: { code: "STORAGE_FAILED", message: "Thumbnail metadata is not available." } };
    }
    return this.storage.listThumbnailMetadata();
  }

  /** Load one project's thumbnail record (Blob). */
  async loadRecord(projectId: string): Promise<ThumbnailLoadResult> {
    return this.storage.getThumbnail(projectId);
  }

  /** Convenience: full record, guarded for UI consumption. */
  async getForProject(projectId: string): Promise<ProjectThumbnailRecord | null> {
    const result = await this.storage.getThumbnail(projectId);
    return result.success ? result.record : null;
  }

  /** Build a lookup map from metadata items. */
  static indexMetadata(items: ProjectThumbnailMetadata[]): Map<string, ProjectThumbnailMetadata> {
    const map = new Map<string, ProjectThumbnailMetadata>();
    for (const item of items) {
      map.set(item.projectId, item);
    }
    return map;
  }
}

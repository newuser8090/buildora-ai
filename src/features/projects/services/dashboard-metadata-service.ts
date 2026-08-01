// ---------------------------------------------------------------------------
// DashboardMetadataService
//
// Manages persistent dashboard metadata (pin state, favorites) through the
// adapter's generic metadata API. Pin state survives page reload, browser
// restart, dashboard remount, and project switching.
//
// Does not modify the core Project document.
// Does not import React.
// ---------------------------------------------------------------------------

import type { ProjectPersistenceAdapter, PersistenceError } from "@/features/persistence/types";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DashboardMetadataService {
  private adapter: ProjectPersistenceAdapter;

  constructor(adapter: ProjectPersistenceAdapter) {
    this.adapter = adapter;
  }

  /**
   * Get the pinned state for a project.
   */
  async isPinned(
    projectId: string,
  ): Promise<boolean> {
    try {
      const result = await this.adapter.getDashboardMetadata(projectId);
      if (!result.success) return false;
      return (result.metadata?.isPinned as boolean) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Get pin state for all projects in a list.
   */
  async getPinMap(
    projectIds: string[],
  ): Promise<Map<string, boolean>> {
    const pinMap = new Map<string, boolean>();
    await Promise.all(
      projectIds.map(async (id) => {
        const pinned = await this.isPinned(id);
        if (pinned) pinMap.set(id, true);
      }),
    );
    return pinMap;
  }

  /**
   * Set or unset the pinned state for a project.
   * Does NOT modify the Project revision or updatedAt.
   */
  async setPinned(
    projectId: string,
    isPinned: boolean,
  ): Promise<{ success: true } | { success: false; error: PersistenceError }> {
    try {
      const current = await this.adapter.getDashboardMetadata(projectId);
      const metadata = current.success
        ? { ...current.metadata, isPinned }
        : { isPinned };
      return this.adapter.setDashboardMetadata(projectId, metadata);
    } catch (err) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: err instanceof Error ? err.message : "Failed to update pin state",
        },
      };
    }
  }

  /**
   * Remove dashboard metadata when a project is deleted.
   */
  async removeMetadata(
    projectId: string,
  ): Promise<{ success: true } | { success: false; error: PersistenceError }> {
    return this.adapter.removeDashboardMetadata(projectId);
  }
}

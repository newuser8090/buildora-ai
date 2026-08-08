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

  // -----------------------------------------------------------------------
  // Archive (Phase P9)
  // -----------------------------------------------------------------------

  /**
   * Set the archived state for a project (Phase P9). Archived projects are
   * hidden from the main dashboard grid and listed in the Archived view.
   * Archiving never deletes the project or its remote deployments.
   */
  async setArchived(
    projectId: string,
    isArchived: boolean,
  ): Promise<{ success: true } | { success: false; error: PersistenceError }> {
    try {
      const current = await this.adapter.getDashboardMetadata(projectId);
      const metadata = current.success
        ? { ...current.metadata, isArchived }
        : { isArchived };
      return this.adapter.setDashboardMetadata(projectId, metadata);
    } catch (err) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: err instanceof Error ? err.message : "Failed to update archive state",
        },
      };
    }
  }

  /**
   * Archive state for all projects in a list.
   * Returns a map of project ID to archived state.
   */
  async getArchivedMap(
    projectIds: string[],
  ): Promise<Map<string, boolean>> {
    const archivedMap = new Map<string, boolean>();
    await Promise.all(
      projectIds.map(async (id) => {
        try {
          const result = await this.adapter.getDashboardMetadata(id);
          if (result.success && result.metadata?.isArchived) {
            archivedMap.set(id, true);
          }
        } catch {
          // Metadata unavailable — proceed without archive state.
        }
      }),
    );
    return archivedMap;
  }
}

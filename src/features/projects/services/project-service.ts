// ---------------------------------------------------------------------------
// ProjectService
//
// Handles project-level operations that do not require live editor orchestration:
//   - listProjects
//   - renameProject (both active and inactive)
//   - duplicateProject
//   - deleteProject (non-active)
//   - pin/unpin
//
// ProjectController remains responsible for active-project lifecycle
// (create, open, switch, delete-active, discard, save).
//
// Framework-independent (no React imports).
// ---------------------------------------------------------------------------

import type {
  ProjectPersistenceAdapter,
  ProjectSummary,
  PersistenceError,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";
import { INITIAL_REVISION } from "@/features/persistence/constants";
import { scheduleThumbnailForSave } from "@/features/thumbnails/services/thumbnail-save-bridge";
import type { ProjectDashboardError } from "../types";
import type { CommitImportedProjectResult, ProjectTransferError } from "../types/project-transfer";
import type { ImportProjectPreview } from "../types/project-transfer";
import { validateProjectName } from "../utils/validate-project-name";
import { DashboardMetadataService } from "./dashboard-metadata-service";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProjectService {
  private adapter: ProjectPersistenceAdapter;

  constructor(adapter: ProjectPersistenceAdapter) {
    this.adapter = adapter;
  }

  // -----------------------------------------------------------------------
  // List
  // -----------------------------------------------------------------------

  /**
   * List all projects as summaries (lightweight, no full project deserialization).
   */
  async listProjects(): Promise<
    { success: true; projects: ProjectSummary[] } | { success: false; error: PersistenceError }
  > {
    return this.adapter.listProjects();
  }

  /**
   * Pin metadata for all projects. Used by the dashboard to determine sort order.
   * Returns a map of project ID to pinned state.
   */
  async getPinMetadata(projectIds: string[]): Promise<Map<string, boolean>> {
    try {
      const metaService = new DashboardMetadataService(this.adapter);
      return metaService.getPinMap(projectIds);
    } catch {
      return new Map();
    }
  }

  // -----------------------------------------------------------------------
  // Rename
  // -----------------------------------------------------------------------

  /**
   * Rename a project.
   *
   * - Validates the new name (trimmed, non-empty, max length)
   * - Active project: loads full project, updates name, saves via adapter
   * - Inactive project: same approach — loads, renames, saves
   *
   * The caller (dashboard controller or ProjectController) decides whether
   * to additionally schedule autosave for the active project.
   */
  async renameProject(
    projectId: string,
    newName: string,
  ): Promise<
    { success: true; project: Project; revision: number } | { success: false; error: PersistenceError | ProjectDashboardError }
  > {
    const trimmed = newName.trim();

    // Use the shared validator
    const validation = validateProjectName(trimmed);
    if (!validation.valid) {
      return {
        success: false,
        error: { code: "INVALID_PROJECT_NAME" as const, message: validation.error! },
      };
    }

    try {
      const loadResult = await this.adapter.loadProject(projectId);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error };
      }

      const project = loadResult.project;
      const oldRevision = loadResult.revision;

      // Update name and timestamp
      project.name = trimmed;
      project.updatedAt = new Date().toISOString();

      const newRevision = oldRevision + 1;

      const saveResult = await this.adapter.saveProject({
        project,
        revision: newRevision,
      });

      if (!saveResult.success) {
        return { success: false, error: saveResult.error };
      }

      return { success: true, project, revision: newRevision };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: err instanceof Error ? err.message : "Failed to rename project",
        } as PersistenceError,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Duplicate
  // -----------------------------------------------------------------------

  /**
   * Duplicate a project with a new ID, revision 1, and fresh timestamps.
   * Nested objects are deep-cloned to avoid shared mutable references.
   * Persistence-only metadata (savedAt, active status) is NOT copied.
   */
  async duplicateProject(
    projectId: string,
    existingNames: string[],
  ): Promise<
    { success: true; project: Project } | { success: false; error: PersistenceError | ProjectDashboardError }
  > {
    try {
      const loadResult = await this.adapter.loadProject(projectId);
      if (!loadResult.success) {
        return { success: false, error: loadResult.error };
      }

      const source = loadResult.project;

      // Deep clone to break all references
      const clone: Project = JSON.parse(JSON.stringify(source));

      // Generate new identity
      const now = new Date().toISOString();
      clone.id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      clone.createdAt = now;
      clone.updatedAt = now;

      // Generate collision-safe name
      clone.name = generateDuplicateName(source.name, existingNames);

      // Persist with revision 1
      const saveResult = await this.adapter.saveProject({
        project: clone,
        revision: INITIAL_REVISION,
      });

      if (!saveResult.success) {
        return { success: false, error: saveResult.error };
      }

      // Phase G policy: a duplicate starts WITHOUT a thumbnail (its new ID has
      // no record) and schedules generation after its first successful save.
      // Non-blocking — a thumbnail failure must never fail the duplicate.
      try {
        scheduleThumbnailForSave({
          project: clone,
          projectId: clone.id,
          revision: INITIAL_REVISION,
        });
      } catch {
        // Never break the duplicate flow over a thumbnail schedule.
      }

      return { success: true, project: clone };
    } catch (err) {
      return {
        success: false,
        error: {
          code: "UNKNOWN_PERSISTENCE_ERROR",
          message: err instanceof Error ? err.message : "Failed to duplicate project",
        },
      };
    }
  }

  // -----------------------------------------------------------------------
  // Delete (non-active)
  // -----------------------------------------------------------------------

  /**
   * Delete a non-active project. For active project deletion, use ProjectController.
   */
  async deleteProject(
    projectId: string,
  ): Promise<{ success: true } | { success: false; error: PersistenceError }> {
    const removeResult = await this.adapter.removeProject(projectId);
    if (!removeResult.success) return removeResult;

    // Clean up dashboard metadata on successful deletion
    try {
      const metaService = new DashboardMetadataService(this.adapter);
      await metaService.removeMetadata(projectId);
    } catch {
      // Preferred policy: deletion succeeds even if metadata cleanup fails.
      // A stale metadata record must never make a deleted project reappear.
    }

    // Phase P7: deployment history belongs to the project — remove it too.
    // Phase P8: custom-domain records as well. Non-blocking: cleanup failure
    // must never fail the delete. (The live provider site is NEVER deleted
    // here — that requires the explicit "Also remove the published site"
    // opt-in in the dashboard delete dialog.)
    try {
      const { DeploymentService } = await import(
        "@/features/publishing/services/deployment-service"
      );
      const { getDeploymentAdapter } = await import(
        "@/features/publishing/storage/deployment-adapter"
      );
      await new DeploymentService(getDeploymentAdapter()).removeDeploymentsForProject(
        projectId,
      );
    } catch {
      // Never break the delete flow over deployment cleanup.
    }
    try {
      // Phase P8: custom-domain records are local product history/cache —
      // clear them too. (Provider-side domain/project deletion requires the
      // explicit "Also remove the published site" opt-in flow, never a
      // silent project delete.)
      const { getDomainAdapter } = await import(
        "@/features/publishing/domain/domain-storage"
      );
      await getDomainAdapter().removeDomainsForProject(projectId);
    } catch {
      // Never break the delete flow over domain cleanup.
    }

    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Pin
  // -----------------------------------------------------------------------

  /**
   * Set or unset the pinned state for a project.
   * Does NOT modify the Project revision or updatedAt.
   */
  async setPinned(
    projectId: string,
    isPinned: boolean,
  ): Promise<
    { success: true } | { success: false; error: PersistenceError }
  > {
    try {
      const metaService = new DashboardMetadataService(this.adapter);
      return metaService.setPinned(projectId, isPinned);
    } catch (err) {
      return {
        success: false,
        error: {
          code: "ACTIVE_PROJECT_FAILED",
          message: err instanceof Error ? err.message : "Failed to update pin state",
        },
      };
    }
  }

  async getPinned(projectId: string): Promise<boolean> {
    try {
      const metaService = new DashboardMetadataService(this.adapter);
      return metaService.isPinned(projectId);
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Import commit
  // -----------------------------------------------------------------------

  /**
   * Commit an imported project to persistence.
   *
   * Steps:
   * 1. Clone project to avoid mutation
   * 2. Assign a new project ID (by default — prevents ID conflicts)
   * 3. Validate and set name
   * 4. Set timestamps (preserve original createdAt by default)
   * 5. Save through the adapter with revision 1
   * 6. Initialize dashboard metadata (unpinned)
   *
   * The caller is responsible for:
   * - Resolving name conflicts before calling
   * - Passing the final validated name
   * - Handling navigation after commit
   */
  async commitImportedProject(
    preview: ImportProjectPreview,
    existingNames: string[],
    options?: {
      name?: string;
      preserveCreatedAt?: boolean;
      importedAt?: string;
    },
  ): Promise<
    CommitImportedProjectResult | { ok: false; error: ProjectTransferError }
  > {
    // Step 1: Clone project to avoid mutation
    let project: Project;
    try {
      project = JSON.parse(JSON.stringify(preview.project));
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "IMPORT_SAVE_FAILED",
          message: "Failed to prepare project for saving.",
          cause: err,
        },
      };
    }

    // Step 2: Assign new project ID
    project.id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Step 3: Set name
    const finalName = options?.name ?? preview.originalProjectName;
    const validation = validateProjectName(finalName);
    if (!validation.valid) {
      return {
        ok: false,
        error: {
          code: "IMPORT_SAVE_FAILED",
          message: validation.error ?? "Invalid project name.",
          details: { name: finalName },
        },
      };
    }
    project.name = finalName.trim();

    // Step 4: Set timestamps
    const now = options?.importedAt ?? new Date().toISOString();

    if (options?.preserveCreatedAt !== false) {
      // Preserve original createdAt (already set from preview.project)
    } else {
      project.createdAt = now;
    }
    project.updatedAt = now;

    // Step 5: Save
    try {
      const saveResult = await this.adapter.saveProject({
        project,
        revision: INITIAL_REVISION,
      });

      if (!saveResult.success) {
        return {
          ok: false,
          error: {
            code: "IMPORT_SAVE_FAILED",
            message: saveResult.error.message ?? "Failed to save imported project.",
            cause: saveResult.error,
          },
        };
      }

      // Step 6: Initialize dashboard metadata (unpinned)
      // Policy: atomic-like rollback — if metadata init fails, delete the
      // newly saved project so we don't leave an orphan behind.
      try {
        const metaService = new DashboardMetadataService(this.adapter);
        const metaResult = await metaService.setPinned(project.id, false);
        if (!metaResult.success) {
          throw metaResult.error;
        }
      } catch (metaErr) {
        // Rollback: delete the project that was just saved
        let rollbackSucceeded = false;
        try {
          await this.adapter.removeProject(project.id);
          await new DashboardMetadataService(this.adapter).removeMetadata(project.id);
          rollbackSucceeded = true;
        } catch {
          // Rollback failure is represented via the error details.
          // The project may still exist in storage — caller should be aware.
        }
        return {
          ok: false,
          error: {
            code: "IMPORT_SAVE_FAILED",
            message: rollbackSucceeded
              ? "Project was saved but metadata initialization failed. Changes have been rolled back."
              : "Project was saved but metadata initialization failed, and the rollback could not be completed. A recoverable orphan project may remain.",
            cause: metaErr,
            details: rollbackSucceeded
              ? { rollbackFailed: false, metadataInitFailed: true }
              : {
                  rollbackFailed: true,
                  metadataInitFailed: true,
                  orphanMayRemain: true,
                  orphanProjectId: project.id,
                },
          },
        };
      }

      // Phase G policy: an imported project starts WITHOUT a thumbnail (its
      // new ID has no record) and schedules generation after its successful
      // commit. Non-blocking — a thumbnail failure must never fail the import.
      try {
        scheduleThumbnailForSave({
          project,
          projectId: project.id,
          revision: INITIAL_REVISION,
        });
      } catch {
        // Never break the import flow over a thumbnail schedule.
      }

      return {
        ok: true,
        project,
        summary: {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          pageCount: project.pages.length,
          assetCount: project.assets.length,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "IMPORT_SAVE_FAILED",
          message: err instanceof Error ? err.message : "Failed to save imported project.",
          cause: err,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateDuplicateName(
  originalName: string,
  existingNames: string[],
): string {
  const baseName = `${originalName} Copy`;
  if (!existingNames.includes(baseName)) return baseName;

  let counter = 2;
  while (existingNames.includes(`${baseName} ${counter}`)) {
    counter++;
  }
  return `${baseName} ${counter}`;
}

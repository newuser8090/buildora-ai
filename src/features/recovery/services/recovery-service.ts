// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — service
//
// Framework-independent. Captures bounded last-known-good snapshots, lists
// them newest-first, and restores a snapshot through the caller's save path.
//
// Retention policy: MAX_RECOVERY_SNAPSHOTS_PER_PROJECT per project, oldest
// evicted first. Snapshots never overwrite the live project themselves —
// restore() hands the snapshot to the caller's persistence save, which is the
// only writer.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import {
  getRecoveryStorage,
  type RecoveryStorageAdapter,
} from "../storage/recovery-storage";
import type { RecoveryError, RecoverySnapshot } from "../types";

/** Maximum recovery snapshots kept per project (bounded retention). */
export const MAX_RECOVERY_SNAPSHOTS_PER_PROJECT = 5;

/** Minimum gap between automatic autosave captures for one project (ms). */
export const RECOVERY_AUTOSAVE_COOLDOWN_MS = 60_000;

export interface CaptureRecoveryInput {
  project: Project;
  revision: number;
  reason: "autosave" | "manual" | "open";
  now?: string;
  /** Bypass the autosave cooldown (manual/open captures). */
  force?: boolean;
}

export type CaptureRecoveryResult =
  | { ok: true; snapshot: RecoverySnapshot; skipped: boolean }
  | { ok: false; error: RecoveryError };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RecoveryService {
  private storage: RecoveryStorageAdapter;
  /** Last automatic capture per project (cooldown map). */
  private lastAutosaveAt = new Map<string, number>();

  constructor(storage?: RecoveryStorageAdapter) {
    this.storage = storage ?? getRecoveryStorage();
  }

  /**
   * Capture a last-known-good snapshot. Validates the project, deep-clones it,
   * applies the per-project retention bound (evicts oldest), and applies the
   * autosave cooldown unless force is set.
   */
  async capture(
    input: CaptureRecoveryInput,
  ): Promise<CaptureRecoveryResult> {
    if (!input.project?.id) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_SNAPSHOT_INVALID",
          message: "There is no project to back up.",
        },
      };
    }

    // Autosave cooldown: at most one automatic snapshot per project per
    // interval. Manual / open captures always run.
    if (!input.force && input.reason === "autosave") {
      const last = this.lastAutosaveAt.get(input.project.id) ?? 0;
      if (Date.now() - last < RECOVERY_AUTOSAVE_COOLDOWN_MS) {
        return { ok: true, snapshot: input.project as unknown as RecoverySnapshot, skipped: true };
      }
      this.lastAutosaveAt.set(input.project.id, Date.now());
    }

    let snapshot: Project;
    try {
      snapshot = JSON.parse(JSON.stringify(input.project)) as Project;
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_SNAPSHOT_INVALID",
          message: "The backup could not be created.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }

    const validation = ProjectSchema.safeParse(snapshot);
    if (!validation.success) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_SNAPSHOT_INVALID",
          message: "This project could not be backed up.",
          cause: validation.error.issues
            .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
            .join("; "),
        },
      };
    }

    const now = input.now ?? new Date().toISOString();
    const record: RecoverySnapshot = {
      id: `snap-${input.project.id}-${input.revision}-${now.replace(/[^0-9]/g, "").slice(0, 13)}`,
      projectId: input.project.id,
      revision: input.revision,
      createdAt: now,
      reason: input.reason,
      project: validation.data,
    };

    const saved = await this.storage.saveSnapshot(record);
    if (!saved.ok) return saved;

    // Bounded retention: keep only the newest MAX per project.
    await this._enforceRetention(input.project.id);
    return { ok: true, snapshot: saved.value, skipped: false };
  }

  async listSnapshots(
    projectId: string,
  ): Promise<{ ok: true; snapshots: RecoverySnapshot[] } | { ok: false; error: RecoveryError }> {
    const result = await this.storage.listSnapshots(projectId);
    if (!result.ok) return result;
    return { ok: true, snapshots: result.value };
  }

  async getSnapshot(
    snapshotId: string,
  ): Promise<{ ok: true; snapshot: RecoverySnapshot | null } | { ok: false; error: RecoveryError }> {
    const result = await this.storage.getSnapshot(snapshotId);
    if (!result.ok) return result;
    return { ok: true, snapshot: result.value };
  }

  /**
   * Validate a stored snapshot for restore. Never touches the live project —
   * the caller persists the returned project through its normal save path.
   */
  async prepareRestore(
    snapshotId: string,
    expectedProjectId: string,
  ): Promise<
    | { ok: true; project: Project; revision: number }
    | { ok: false; error: RecoveryError }
  > {
    const got = await this.storage.getSnapshot(snapshotId);
    if (!got.ok) return got;
    if (!got.value) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_NOT_FOUND",
          message: "That backup no longer exists.",
        },
      };
    }
    if (got.value.projectId !== expectedProjectId) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_SNAPSHOT_INVALID",
          message: "That backup belongs to a different project.",
        },
      };
    }

    const validation = ProjectSchema.safeParse(got.value.project);
    if (!validation.success) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_SNAPSHOT_INVALID",
          message: "That backup could not be restored.",
          cause: validation.error.issues
            .map((issue) => `${issue.path.join(".")} — ${issue.message}`)
            .join("; "),
        },
      };
    }

    // Keep the same project id — a recovery never renames/relocates.
    const project = {
      ...validation.data,
      id: expectedProjectId,
    };
    return { ok: true, project, revision: got.value.revision };
  }

  async clearForProject(projectId: string): Promise<{ ok: true } | { ok: false; error: RecoveryError }> {
    const result = await this.storage.clearForProject(projectId);
    if (!result.ok) return result;
    this.lastAutosaveAt.delete(projectId);
    return { ok: true };
  }

  /** Test helper — reset the cooldown map. */
  resetCooldownsForTests(): void {
    this.lastAutosaveAt.clear();
  }

  private async _enforceRetention(projectId: string): Promise<void> {
    try {
      const list = await this.storage.listSnapshots(projectId);
      if (!list.ok) return;
      const excess = list.value.slice(MAX_RECOVERY_SNAPSHOTS_PER_PROJECT);
      for (const old of excess) {
        await this.storage.deleteSnapshot(old.id);
      }
    } catch {
      // Retention is best-effort — never fail the capture over eviction.
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let serviceSingleton: RecoveryService | null = null;

export function getRecoveryService(): RecoveryService {
  if (!serviceSingleton) {
    serviceSingleton = new RecoveryService();
  }
  return serviceSingleton;
}

export function setRecoveryServiceForTests(service: RecoveryService | null): void {
  serviceSingleton = service;
}

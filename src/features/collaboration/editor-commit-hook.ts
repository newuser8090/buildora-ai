// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — editor commit hook registry
//
// A tiny, import-free indirection that lets the editor store route its single
// commit boundary (withHistory) through the active collaboration session:
//
//   applyLocalProject(nextProject) — apply a local mutation as a CRDT
//     transaction (one Yjs transaction, local origin → undo-scoped)
//   undo/redo/canUndo/canRedo      — Yjs UndoManager routing
//
// When no hook is registered (personal projects, read-only previews,
// non-collaborative flows) the editor keeps its existing history behavior
// exactly. The session registers/unregisters the hook on start/stop.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Remote projection flag
//
// The collab session projects the CRDT into the editor store via
// applyRemoteProject. The persistence controller's store subscription treats
// every project-reference change as a local edit (revision bump + dirty +
// autosave). Remote projections must NOT do that — the CRDT is already synced,
// and the session owns the durable checkpoint. The projection wraps its write
// in beginRemoteProjection()/endRemoteProjection() (synchronous, so the
// controller's synchronous zustand subscription observes the flag while it is
// set); the controller checks isRemoteProjection() and skips its edit bookkeeping.
// ---------------------------------------------------------------------------

let remoteProjectionDepth = 0;

export function beginRemoteProjection(): void {
  remoteProjectionDepth += 1;
}

export function endRemoteProjection(): void {
  remoteProjectionDepth -= 1;
}

/** True while the store is being written by a CRDT projection. */
export function isRemoteProjection(): boolean {
  return remoteProjectionDepth > 0;
}

export interface CollabCommitHook {
  /** Apply a local mutation to the collaborative document (one transaction). */
  applyLocalProject(nextProject: Project): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

let activeHook: CollabCommitHook | null = null;

export function setCollabCommitHook(hook: CollabCommitHook | null): void {
  activeHook = hook;
}

export function getCollabCommitHook(): CollabCommitHook | null {
  return activeHook;
}

/** True when the editor is currently in a collaborative commit mode. */
export function isCollabCommitActive(): boolean {
  return activeHook !== null;
}

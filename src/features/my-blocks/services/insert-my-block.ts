// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — canonical insertion operation
//
// insertMyBlock() is the ONE way saved blocks become persistent project
// content. It:
//   - loads + validates the stored record (schema validation on read)
//   - deep-clones the stored tree (project copies never share references)
//   - delegates to the Phase P3 canonical insertion service, which re-IDs
//     every node fresh (never reuses template ids, never collides with
//     project/page/section/block ids), enforces nesting rules, commits as
//     ONE history entry + one revision + one autosave sequence
//   - leaves the project untouched on any failure (failed insertion = no-op)
//   - updates lightweight usage metadata AFTER a successful commit
//     (library metadata only — no project history, no network)
//
// Insertion NEVER routes through UI-only preview state.
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { collectBlockTreeIds, type RemapOptions } from "@/features/code-import/services/id-remapper";
import {
  insertImportedBlockTree,
  type ImportPlacement,
} from "@/features/code-import/services/insert-imported-block-tree";
import { parseMyBlockRecord } from "../schemas/my-block-schema";
import { makeMyBlockError } from "../errors";
import type {
  MyBlocksStorageAdapter,
} from "../types";

// ---------------------------------------------------------------------------
// Request / result
// ---------------------------------------------------------------------------

export interface InsertMyBlockRequest {
  projectId: string;
  /** The saved block to insert (loaded + validated by the caller's store). */
  blockId: string;
  placement: ImportPlacement;
  /** Injectable id factory (deterministic tests). */
  idFactory?: RemapOptions["idFactory"];
  /** Injectable adapter (tests). Defaults to the singleton browser adapter. */
  adapter?: MyBlocksStorageAdapter;
  /** When true, skip the usage-metadata bump (tests / previews). */
  skipUsageBump?: boolean;
}

export type InsertMyBlockResult =
  | { ok: true; sectionId: string; pageId: string; kind: ImportPlacement["kind"] }
  | { ok: false; error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Canonical operation
// ---------------------------------------------------------------------------

/**
 * Insert a saved My Block into the project. Every inserted node receives a
 * fresh id. Any failure leaves the project untouched.
 */
export async function insertMyBlock(
  request: InsertMyBlockRequest,
): Promise<InsertMyBlockResult> {
  // 1. Load + validate the record (schema validation on read). Adapter errors
  //    pass through — a corrupt record surfaces as INVALID_RECORD, not a
  //    generic not-found.
  const loaded = await request.adapter?.getMyBlock(request.blockId);
  if (!loaded) {
    return {
      ok: false,
      error: makeMyBlockError("BLOCK_NOT_FOUND", "That saved block no longer exists."),
    };
  }
  if (!loaded.ok) {
    return { ok: false, error: loaded.error };
  }
  const record = loaded.value;
  const parsed = parseMyBlockRecord(record);
  if (!parsed || parsed.tree.rootIds.length === 0) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", "That saved block is damaged and cannot be inserted."),
    };
  }

  // 2. Deep clone so the project copy shares no references with the library.
  const tree = cloneTreeDeep(parsed.tree as BlockTree);

  // 3. Validate the record before inserting (cheap extra guard).
  const validation = validateRecordAgainstPlacement(tree, request.placement);
  if (!validation.ok) return validation;

  // 4. Delegate to the canonical Phase P3 insertion (fresh ID remapping +
  //    atomic one-entry commit happen inside). The stored tree's template ids
  //    are never reused — remapBlockTreeIds handles collision avoidance.
  const result = insertImportedBlockTree({
    projectId: request.projectId,
    placement: request.placement,
    tree,
    name: parsed.name,
    sourceMetadata: parsed.sourceMetadata
      ? {
          language: parsed.sourceMetadata.language ?? "unknown",
          importedAt: new Date().toISOString(),
          sourceHash: "my-block",
          converterVersion: parsed.sourceMetadata.converterVersion ?? 1,
          warningCount: parsed.sourceMetadata.originalWarningCount ?? 0,
        }
      : undefined,
    idFactory: request.idFactory,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // 5. Usage metadata bump (UI metadata only — never project history).
  if (!request.skipUsageBump) {
    void request.adapter
      ?.updateMyBlock(request.blockId, {
        lastUsedAt: new Date().toISOString(),
        useCount: (parsed.useCount ?? 0) + 1,
      })
      .catch(() => {
        // Library metadata is best-effort; insertion already succeeded.
      });
  }

  return { ok: true, sectionId: result.sectionId, pageId: result.pageId, kind: result.kind };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Cheap pre-flight checks that depend only on the record + placement. The
 * authoritative validation (nesting rules, id collisions) happens inside the
 * canonical insertion service; this only rejects obviously-invalid inputs
 * early with clear messages.
 */
function validateRecordAgainstPlacement(
  tree: BlockTree,
  placement: ImportPlacement,
): { ok: true } | { ok: false; error: { code: string; message: string } } {
  if (tree.rootIds.length === 0) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", "This saved block has no usable root."),
    };
  }
  if (placement.kind === "inside-custom-block" && !placement.parentBlockId) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_TARGET", "Choose a container inside the design to add into."),
    };
  }
  // Node cap sanity (the schema caps at 400, so this is defensive only).
  if (Object.keys(tree.nodes).length > 400) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", "This saved block is too large to insert."),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep clone a tree (plain JSON clone keeps it serialization-safe). */
function cloneTreeDeep(tree: BlockTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = JSON.parse(JSON.stringify(node)) as BlockNode;
  }
  return { rootIds: [...tree.rootIds], nodes };
}

/** Export used by tests to assert collision-avoidance inputs. */
export { collectBlockTreeIds };

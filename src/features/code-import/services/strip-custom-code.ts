// ---------------------------------------------------------------------------
// P23-E distribution hardening
//
// Custom code is editor-owned data and may survive persistence/collaboration,
// but it must not cross into reusable/distributed artifacts that are not the
// published export. These helpers strip the node-level customCode payload
// without changing any other tree/project data.
//
// Pure, deterministic, non-mutating.
// ---------------------------------------------------------------------------

import type { BlockTree } from "@/features/blocks/types";
import type { StoredCustomBlockNode } from "@/features/code-import/schemas/custom-block-schema";
import type { Project } from "@/types/project";

/** Remove node-level customCode from a tree without mutating the input. */
export function stripCustomCodeFromTree(tree: BlockTree): BlockTree {
  const nodes: BlockTree["nodes"] = {};

  for (const [id, node] of Object.entries(tree.nodes)) {
    // Persisted custom-block nodes may carry schema-level customCode that the
    // universal BlockNode type does not model (P23-C). The JSON clone is a
    // runtime value, so it is cast to the existing stored-node shape — the
    // narrowest type that captures the runtime payload. Dropping customCode
    // yields a plain BlockNode, so no further cast is needed on assignment.
    const clone = JSON.parse(JSON.stringify(node)) as StoredCustomBlockNode;
    delete clone.customCode;
    nodes[id] = clone;
  }

  return {
    rootIds: [...tree.rootIds],
    nodes,
  };
}

/** Remove node-level customCode from any tree-shaped payload. */
function stripCustomCodeFromTreeRecord(tree: unknown): void {
  if (!tree || typeof tree !== "object") return;
  const treeRecord = tree as Record<string, unknown>;
  const nodes = treeRecord.nodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;

  for (const node of Object.values(nodes as Record<string, unknown>)) {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      delete (node as Record<string, unknown>).customCode;
    }
  }
}

/**
 * Remove customCode from all trees in a Project without mutating the input.
 * Covers both persisted custom-block trees (`props.tree`) and Phase P24-B
 * durable section-level element trees (`section.tree` on ANY section type),
 * so an enabled editor node can never reach a distributed artifact through
 * the new durable surface. All unrelated fields are preserved verbatim.
 */
export function stripCustomCodeFromProject(project: Project): Project {
  const cloned = JSON.parse(JSON.stringify(project)) as Project;

  for (const page of cloned.pages) {
    for (const section of page.sections) {
      if (section.type === "custom-block") {
        const props = section.props as Record<string, unknown> | undefined;
        stripCustomCodeFromTreeRecord(props?.tree);
      }
      // Phase P24-B — durable section-level element trees (regular sections).
      stripCustomCodeFromTreeRecord((section as { tree?: unknown }).tree);
    }
  }

  return cloned;
}

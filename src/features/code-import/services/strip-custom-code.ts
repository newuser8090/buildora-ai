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
import type { Project } from "@/types/project";

/** Remove node-level customCode from a tree without mutating the input. */
export function stripCustomCodeFromTree(tree: BlockTree): BlockTree {
  const nodes: BlockTree["nodes"] = {};

  for (const [id, node] of Object.entries(tree.nodes)) {
    const clone = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
    delete clone.customCode;
    nodes[id] = clone as BlockTree["nodes"][string];
  }

  return {
    rootIds: [...tree.rootIds],
    nodes,
  };
}

/**
 * Remove customCode from all custom-block trees in a Project without
 * mutating the input. Non-custom-block sections and all unrelated fields are
 * preserved verbatim.
 */
export function stripCustomCodeFromProject(project: Project): Project {
  const cloned = JSON.parse(JSON.stringify(project)) as Project;

  for (const page of cloned.pages) {
    for (const section of page.sections) {
      if (section.type !== "custom-block") continue;

      const props = section.props as Record<string, unknown> | undefined;
      const tree = props?.tree;
      if (!tree || typeof tree !== "object") continue;

      const treeRecord = tree as Record<string, unknown>;
      const nodes = treeRecord.nodes;
      if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) continue;

      for (const node of Object.values(nodes as Record<string, unknown>)) {
        if (node && typeof node === "object" && !Array.isArray(node)) {
          delete (node as Record<string, unknown>).customCode;
        }
      }
    }
  }

  return cloned;
}

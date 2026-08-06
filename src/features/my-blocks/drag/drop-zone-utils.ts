// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — drop zone model
//
// Drop zones are thin descriptors rendered only while a My Block drag is
// active. The payload carried by each droppable contains ONLY placement
// coordinates (never the tree). Validation reuses the Phase P3 canonical
// canPlaceInside() so the UI never duplicates insertion rules.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import {
  canPlaceInside,
  type ImportPlacement,
} from "@/features/code-import/services/insert-imported-block-tree";

export type MyBlockDropZoneKind =
  | "before-section"
  | "after-section"
  | "inside-custom-block"
  | "end-of-page";

export interface MyBlockDropZonePayload {
  kind: MyBlockDropZoneKind;
  pageId: string;
  sectionId?: string;
  parentBlockId?: string;
  /** Friendly beginner label ("Add here", "Place inside this group", …). */
  label: string;
}

export type DropZoneValidationResult =
  | { ok: true; placement: ImportPlacement }
  | { ok: false; reason: string };

/** Convert a drop zone payload into the canonical ImportPlacement. */
export function dropZoneToPlacement(
  zone: MyBlockDropZonePayload,
): ImportPlacement {
  switch (zone.kind) {
    case "before-section":
      return { kind: "before-section", pageId: zone.pageId, sectionId: zone.sectionId };
    case "after-section":
      return { kind: "after-section", pageId: zone.pageId, sectionId: zone.sectionId };
    case "inside-custom-block":
      return {
        kind: "inside-custom-block",
        pageId: zone.pageId,
        sectionId: zone.sectionId,
        parentBlockId: zone.parentBlockId,
      };
    case "end-of-page":
      return { kind: "end-of-page", pageId: zone.pageId };
  }
}

/**
 * Validate a drop zone against the live project + the dragged record's tree.
 * Uses the canonical canPlaceInside() for inside placement; structural checks
 * for section/page placements. The authoritative insertion-time validation
 * still runs inside insertMyBlock — this is only for UI feedback.
 */
export function validateDropZone(
  zone: MyBlockDropZonePayload,
  project: Project,
  tree: BlockTree | null,
): DropZoneValidationResult {
  const page = project.pages.find((p) => p.id === zone.pageId);
  if (!page) return { ok: false, reason: "That page no longer exists." };
  if (!tree || tree.rootIds.length === 0) {
    return { ok: false, reason: "This saved block has no usable content." };
  }

  switch (zone.kind) {
    case "before-section":
    case "after-section": {
      const section = page.sections.find((s) => s.id === zone.sectionId);
      if (!section) {
        return { ok: false, reason: "That part of the page no longer exists." };
      }
      return { ok: true, placement: dropZoneToPlacement(zone) };
    }
    case "end-of-page":
      return { ok: true, placement: dropZoneToPlacement(zone) };
    case "inside-custom-block": {
      const compat = canPlaceInside(
        project,
        zone.pageId,
        zone.sectionId ?? "",
        zone.parentBlockId,
        tree,
      );
      if (!compat.ok) {
        return { ok: false, reason: compat.reason ?? "This piece cannot go there." };
      }
      return { ok: true, placement: dropZoneToPlacement(zone) };
    }
  }
}

// ---------------------------------------------------------------------------
// Durable section-tree commit preparation
//
// Phase P26 Slice 1 — the REGULAR-section half of the durable commit contract,
// extracted into ONE pure function so the editor store and the AI plan
// simulator cannot drift.
//
// Why this exists: `prepareSectionTreeCommit` (editor store) is the live commit
// boundary, while the AI plan path applies a plan on a CLONE (`simulatePlan` →
// `applyElementOp`) and then commits the resulting project wholesale. If the
// simulator folded element edits the way the legacy block pipeline does, the
// write would land in `props`/`styles` only and leave `section.tree` stale —
// silently discarding geometry / viewport / animation / interaction / custom
// code, which is exactly the loss P22-H avoided by refusing non-custom-block
// element targets in the first place. Both callers now share this function.
//
// Custom-block sections do NOT come through here — they keep their existing
// whole-tree `props.tree` fold (`elementTreeToSection` + the custom-block
// branch), never rewritten and never duplicated.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import type { ElementTree, SectionElement } from "@/features/elements/types";
import { normalizeElementTree } from "@/features/elements/serialization/element-normalizer";
import {
  elementTreeToSection,
  sectionToElementTree,
} from "./section-element-adapter";

/**
 * Key-order-insensitive deep equality for plain JSON values. Used for no-op
 * detection on durable trees (JSON.stringify is key-order sensitive and would
 * produce false "changed" results after schema re-parsing).
 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepEqualJson(value, b[index]));
  }
  if (
    a !== null && b !== null &&
    typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqualJson(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}

export type DurableSectionCommit =
  | { ok: true; changed: false }
  | { ok: true; changed: true; section: SectionElement }
  | { ok: false; reason: string };

/**
 * Prepare a durable commit for a REGULAR (non-custom-block) section.
 *
 * Pure — the caller applies the result through `withHistory` as ONE history
 * entry, or writes it into its own project clone (the simulator).
 *
 * No-op detection mirrors the store exactly: a section that is already durable
 * is unchanged when the incoming tree deep-equals its stored tree; a legacy
 * section is unchanged when the incoming tree deep-equals what the current
 * props already materialize to (so a no-op commit never eagerly materializes a
 * legacy section and never creates a useless history entry).
 */
export function prepareDurableSectionCommit(
  section: BaseSection,
  tree: ElementTree,
): DurableSectionCommit {
  const normalized = normalizeElementTree(tree);
  if (!normalized) {
    return { ok: false, reason: "The element tree is too corrupt to repair." };
  }
  const folded = elementTreeToSection(normalized, section);
  if (!folded.ok) return { ok: false, reason: folded.error.message };

  const durable = section.tree;
  if (durable) {
    if (deepEqualJson(durable, normalized)) return { ok: true, changed: false };
  } else {
    const materialized = sectionToElementTree(section);
    if (deepEqualJson(materialized, normalized)) return { ok: true, changed: false };
  }

  return {
    ok: true,
    changed: true,
    section: {
      ...section,
      tree: normalized,
      props: folded.value.section.props,
      styles: folded.value.section.styles,
    },
  };
}

// ---------------------------------------------------------------------------
// Section structure — pure array manipulation helpers
//
// Shared by reorder / move / insert / duplicate / delete. These functions are
// framework-independent and NEVER mutate the input arrays. They return either
// a new ordered array or a structured error. The editor store wraps them in a
// single history entry per logical action.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Insertion position
// ---------------------------------------------------------------------------

export type SectionInsertPosition =
  | { type: "start" }
  | { type: "end" }
  | { type: "before"; sectionId: string }
  | { type: "after"; sectionId: string };

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

export type StructureErrorCode =
  | "SECTION_NOT_FOUND"
  | "TARGET_NOT_FOUND"
  | "SECTION_ID_CONFLICT"
  | "SINGLETON_SECTION_EXISTS"
  | "INVALID_INSERT_POSITION"
  | "CANNOT_MOVE_OUT_OF_BOUNDS";

export interface StructureError {
  code: StructureErrorCode;
  message: string;
}

export type StructureResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StructureError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface ReorderInput {
  sections: BaseSection[];
  activeSectionId: string;
  overSectionId: string;
}

export interface ReorderOutput {
  sections: BaseSection[];
  /** True when the order actually changed (false for no-ops). */
  changed: boolean;
  /** Index of the moved section in the new array. */
  activeIndex: number;
}

/**
 * Canonical reorder: move activeSection to overSection's position.
 * Mirrors dnd-kit's arrayMove semantics. Returns the SAME array reference
 * (plus changed:false) when the move is a no-op.
 */
export function reorderSections(input: ReorderInput): StructureResult<ReorderOutput> {
  const { sections, activeSectionId, overSectionId } = input;

  const fromIndex = sections.findIndex((s) => s.id === activeSectionId);
  if (fromIndex === -1) {
    return {
      ok: false,
      error: {
        code: "SECTION_NOT_FOUND",
        message: `Section "${activeSectionId}" does not exist.`,
      },
    };
  }

  if (activeSectionId === overSectionId) {
    return {
      ok: true,
      value: { sections, changed: false, activeIndex: fromIndex },
    };
  }

  const toIndex = sections.findIndex((s) => s.id === overSectionId);
  if (toIndex === -1) {
    return {
      ok: false,
      error: {
        code: "TARGET_NOT_FOUND",
        message: `Target section "${overSectionId}" does not exist.`,
      },
    };
  }

  const next = moveItem(sections, fromIndex, toIndex);
  if (next === sections) {
    return {
      ok: true,
      value: { sections, changed: false, activeIndex: fromIndex },
    };
  }

  const activeIndex = next.findIndex((s) => s.id === activeSectionId);
  return { ok: true, value: { sections: next, changed: true, activeIndex } };
}

export interface MoveInput {
  sections: BaseSection[];
  sectionId: string;
  targetIndex: number;
}

/** Move a section to an absolute index (0-based). No-op when already there. */
export function moveSectionToIndex(
  input: MoveInput,
): StructureResult<ReorderOutput> {
  const { sections, sectionId, targetIndex } = input;

  const fromIndex = sections.findIndex((s) => s.id === sectionId);
  if (fromIndex === -1) {
    return {
      ok: false,
      error: {
        code: "SECTION_NOT_FOUND",
        message: `Section "${sectionId}" does not exist.`,
      },
    };
  }

  if (targetIndex < 0 || targetIndex >= sections.length) {
    return {
      ok: false,
      error: {
        code: "CANNOT_MOVE_OUT_OF_BOUNDS",
        message: `Target index ${targetIndex} is out of bounds (0–${sections.length - 1}).`,
      },
    };
  }

  if (targetIndex === fromIndex) {
    return {
      ok: true,
      value: { sections, changed: false, activeIndex: fromIndex },
    };
  }

  const next = moveItem(sections, fromIndex, targetIndex);
  const activeIndex = next.findIndex((s) => s.id === sectionId);
  return { ok: true, value: { sections: next, changed: true, activeIndex } };
}

/**
 * Pure array move. Returns the same reference when the move is a no-op.
 * Insert-after semantics when moving down (matches dnd-kit arrayMove).
 */
function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const normalized = Math.max(0, Math.min(toIndex, items.length - 1));
  if (fromIndex === normalized) return items;

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(normalized, 0, moved);
  return next;
}

export interface InsertInput {
  sections: BaseSection[];
  section: BaseSection;
  position: SectionInsertPosition;
}

export interface InsertOutput {
  sections: BaseSection[];
  index: number;
}

/**
 * Insert a section at the requested position. Validates the target when the
 * position references a section. Returns INVALID_INSERT_POSITION for an
 * unknown position type.
 */
export function insertSectionAt(
  input: InsertInput,
): StructureResult<InsertOutput> {
  const { sections, section, position } = input;

  switch (position.type) {
    case "start":
      return {
        ok: true,
        value: { sections: [section, ...sections], index: 0 },
      };
    case "end":
      return {
        ok: true,
        value: { sections: [...sections, section], index: sections.length },
      };
    case "before":
    case "after": {
      const targetIndex = sections.findIndex((s) => s.id === position.sectionId);
      if (targetIndex === -1) {
        return {
          ok: false,
          error: {
            code: "TARGET_NOT_FOUND",
            message: `Target section "${position.sectionId}" does not exist.`,
          },
        };
      }
      const insertIndex =
        position.type === "before" ? targetIndex : targetIndex + 1;
      const next = [...sections];
      next.splice(insertIndex, 0, section);
      return { ok: true, value: { sections: next, index: insertIndex } };
    }
    default:
      return {
        ok: false,
        error: {
          code: "INVALID_INSERT_POSITION",
          message: `Unknown insert position.`,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Order normalization
// ---------------------------------------------------------------------------

/**
 * Normalize section `order` fields to contiguous integers (1-based, matching
 * the existing project/export convention). Returns a NEW array when orders
 * needed rewriting; the same reference when already normalized.
 */
export function normalizeSectionOrders(sections: BaseSection[]): BaseSection[] {
  let needsRewrite = false;
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].order !== i + 1) {
      needsRewrite = true;
      break;
    }
  }
  if (!needsRewrite) return sections;

  return sections.map((section, i) => ({
    ...section,
    order: i + 1,
  }));
}

// ---------------------------------------------------------------------------
// Selection policy after delete
// ---------------------------------------------------------------------------

/**
 * Compute the next selection id after removing `deletedId`.
 *   - nearest next section (the one that took the deleted slot), else
 *   - previous section, else
 *   - null
 */
export function selectionAfterDelete(
  sections: BaseSection[],
  deletedId: string,
): string | null {
  const index = sections.findIndex((s) => s.id === deletedId);
  if (index === -1) return null;
  const remaining = sections.filter((s) => s.id !== deletedId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(index, remaining.length - 1)].id ?? null;
}

// ---------------------------------------------------------------------------
// Inline field update service — pure, deterministic, never mutates
//
// updateEditableField(project, descriptor, nextValue) clones only the
// necessary project branches, applies the value at the validated path, and
// validates the resulting section through the canonical section schema.
//
// Guarantees:
//   - no store mutation, no persistence, no history
//   - only registered safe field paths are writable
//   - href / AssetRef / price / id fields can never be reached (registry-only)
//   - structured errors per Phase M error model
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import { isSupportedFieldPath, getValueAtPath } from "../registry/editable-field-registry";
import type {
  EditableFieldDescriptor,
  FieldPathSegment,
  InlineAiError,
} from "../types";

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function err(code: InlineAiError["code"], message: string): { ok: false; error: InlineAiError } {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Clone helpers — clone only necessary branches
// ---------------------------------------------------------------------------

function cloneSection(section: BaseSection): BaseSection {
  return JSON.parse(JSON.stringify(section)) as BaseSection;
}

/**
 * Apply `value` at `path` inside a cloned section's props. The path must have
 * been validated against the registry. Returns the section with the applied
 * value (the section itself is cloned; the project is NOT touched here).
 */
function applyValueAtPath(
  section: BaseSection,
  path: FieldPathSegment[],
  value: string,
): BaseSection {
  const next = cloneSection(section);
  const props = next.props;
  let cursor: unknown = props;

  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    const isLast = i === path.length - 1;

    if (typeof segment === "number") {
      // Array index — must already exist; never grows arrays.
      if (!Array.isArray(cursor)) throw new Error("INLINE_FIELD_PATH_INVALID");
      const target = cursor as unknown[];
      if (segment < 0 || segment >= target.length) throw new Error("INLINE_FIELD_PATH_INVALID");
      if (isLast) {
        target[segment] = value;
      } else {
        cursor = target[segment];
      }
      continue;
    }

    // Object key — must already exist (registry-only paths).
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      throw new Error("INLINE_FIELD_PATH_INVALID");
    }
    const record = cursor as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      throw new Error("INLINE_FIELD_PATH_INVALID");
    }
    if (isLast) {
      record[segment] = value;
    } else {
      cursor = record[segment];
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type UpdateEditableFieldResult =
  | { ok: true; project: Project; section: BaseSection; changed: boolean }
  | { ok: false; error: InlineAiError };

/**
 * Compute the project that results from writing `nextValue` into the field
 * described by `descriptor`. Pure — the input project is never mutated.
 *
 * The returned project reuses all untouched branches (only the target page
 * and section are cloned), so structural sharing is preserved.
 */
export function updateEditableField(
  project: Project,
  descriptor: EditableFieldDescriptor,
  nextValue: string,
): UpdateEditableFieldResult {
  // 1. Page must exist
  const pageIndex = project.pages.findIndex((p) => p.id === descriptor.pageId);
  if (pageIndex === -1) {
    return err("INLINE_FIELD_NOT_FOUND", `Page "${descriptor.pageId}" does not exist.`);
  }
  const page = project.pages[pageIndex];

  // 2. Section must exist
  const sectionIndex = page.sections.findIndex((s) => s.id === descriptor.sectionId);
  if (sectionIndex === -1) {
    return err("INLINE_FIELD_NOT_FOUND", `Section "${descriptor.sectionId}" does not exist.`);
  }
  const section = page.sections[sectionIndex];

  // 3. Section type must match
  if (section.type !== descriptor.sectionType) {
    return err(
      "INLINE_FIELD_UNSUPPORTED",
      `Section "${descriptor.sectionId}" is type "${section.type}", not "${descriptor.sectionType}".`,
    );
  }

  // 4. Path must be a registered safe field for this section type
  if (!isSupportedFieldPath(section.type, descriptor.fieldPath)) {
    return err(
      "INLINE_FIELD_PATH_INVALID",
      `Field path "${descriptor.fieldPath.join(".")}" is not a registered editable field on "${section.type}" sections.`,
    );
  }

  // 5. Value must be a non-empty string within the field's max length
  if (typeof nextValue !== "string") {
    return err("INLINE_VALUE_INVALID", "Field value must be text.");
  }
  const trimmed = descriptor.kind === "textarea" ? nextValue : nextValue.trim();
  if (trimmed.length === 0) {
    return err("INLINE_VALUE_INVALID", "Field value cannot be empty.");
  }
  if (descriptor.maxLength !== undefined && trimmed.length > descriptor.maxLength) {
    return err(
      "INLINE_VALUE_INVALID",
      `Field value is ${trimmed.length} characters — the limit is ${descriptor.maxLength}.`,
    );
  }

  // 6. No-op — unchanged value (skip history)
  const current = getValueAtPath(section.props, descriptor.fieldPath);
  if (current === trimmed) {
    return { ok: true, project, section, changed: false };
  }

  // 7. Apply value on a cloned section
  let nextSection: BaseSection;
  try {
    nextSection = applyValueAtPath(section, descriptor.fieldPath, trimmed);
  } catch {
    return err(
      "INLINE_FIELD_PATH_INVALID",
      `Field path "${descriptor.fieldPath.join(".")}" is not writable on the current data.`,
    );
  }

  // 8. Validate the resulting section through the canonical schema
  const validation = AnySectionSchema.safeParse(nextSection);
  if (!validation.success) {
    return err(
      "INLINE_VALUE_INVALID",
      "This value does not fit the section schema. Check the field's allowed content.",
    );
  }

  // 9. Rebuild the project with only the target page cloned
  const nextPage = {
    ...page,
    sections: page.sections.map((s, i) =>
      i === sectionIndex ? (validation.data as BaseSection) : s,
    ),
  };
  const nextProject: Project = {
    ...project,
    pages: project.pages.map((p, i) => (i === pageIndex ? nextPage : p)),
  };

  return { ok: true, project: nextProject, section: validation.data as BaseSection, changed: true };
}

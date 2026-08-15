// ---------------------------------------------------------------------------
// Plan simulator — pure, deterministic application of AI edit operations
//
// Responsibilities (spec §8):
//   - deep-clone the source project
//   - apply operations sequentially to the clone
//   - reuse the canonical section/page structure helpers and routing
//     validation (same rules the editor store and export pipeline use)
//   - validate the final project through ProjectSchema + per-type section
//     schemas + routing rules
//   - produce operation-level results and warnings
//   - NEVER mutate the store, NEVER persist, NEVER create history
//   - deterministic output for a given input
//
// Used for: server-side plan validation, client-side preview/diffs, stale-plan
// revalidation, store application, and tests.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import type { Page, Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import { isSingletonSectionType } from "@/features/editor/section-library/types";
import {
  insertSectionAt,
  moveSectionToIndex,
  normalizeSectionOrders,
} from "@/features/editor/store/section-structure";
import {
  deletePageFromList,
  movePageToIndex,
  renamePageInList,
  sanitizePageMeta,
  validatePageTitle,
} from "@/features/editor/store/page-structure";
import { validateRoutingForExport } from "@/features/routing/routes";
import {
  elementTreeToSection,
  sectionToElementTree,
} from "@/features/elements/adapters/section-element-adapter";
import { isCustomBlockSection } from "@/features/blocks/adapters/section-block-adapter";
import {
  applyElementOperation,
  createElement,
} from "@/features/elements/engine/element-operations";
import { isRenderableElementType } from "@/features/elements/registry/element-registry";
import type {
  AiEditOperation,
  AiEditPlanError,
  AiEditWarning,
  AiOperationSimulationResult,
  SimulatePlanResult,
} from "../plan-types";
import { formatZodIssues } from "../schemas/plan-schemas";
import type { ElementTree, ElementType } from "@/features/elements/types";
import type { ElementResult } from "@/features/elements/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneProject(project: Project): Project {
  return deepClone(project);
}

function opError(
  op: AiEditOperation,
  message: string,
  field?: string,
): { ok: false; error: AiEditPlanError } {
  return {
    ok: false,
    error: { code: "PLAN_OPERATION_INVALID", message, operationId: op.id, field },
  };
}

// ---------------------------------------------------------------------------
// Per-operation application
// ---------------------------------------------------------------------------

type ApplyResult =
  | {
      ok: true;
      project: Project;
      changed: boolean;
      detail?: string;
      warnings?: AiEditWarning[];
    }
  | { ok: false; error: AiEditPlanError };

function findPage(project: Project, pageId: string): Page | undefined {
  return project.pages.find((p) => p.id === pageId);
}

function findSection(
  project: Project,
  pageId: string,
  sectionId: string,
): { page: Page; index: number; section: BaseSection } | undefined {
  const page = findPage(project, pageId);
  if (!page) return undefined;
  const index = page.sections.findIndex((s) => s.id === sectionId);
  if (index === -1) return undefined;
  return { page, index, section: page.sections[index] };
}

/**
 * Warn when a before/after props diff drops href- or asset-bearing fields —
 * links and AssetRefs must be preserved unless explicitly changed.
 */
function preserveWarnings(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  sectionId: string,
): AiEditWarning[] {
  const warnings: AiEditWarning[] = [];
  const sensitive = (key: string) =>
    /(href|image|asset|iconimage)$/i.test(key) ||
    key === "logoImage" ||
    key === "heroImage" ||
    key === "backgroundImage";
  for (const key of Object.keys(before)) {
    if (!sensitive(key)) continue;
    if (after[key] === undefined && before[key] !== undefined) {
      warnings.push({
        code: "PRESERVED_FIELD_DROPPED",
        message: `"${key}" was removed from section ${sectionId} — links and asset references are preserved unless explicitly changed.`,
        operationId: undefined,
      });
    }
  }
  return warnings;
}

function applyUpdateSectionProps(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-section-props" }>,
): ApplyResult {
  const found = findSection(project, op.pageId, op.sectionId);
  if (!found) {
    const page = findPage(project, op.pageId);
    if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");
    return opError(op, `Section "${op.sectionId}" does not exist on page "${op.pageId}".`, "sectionId");
  }
  if (found.section.type !== op.sectionType) {
    return opError(
      op,
      `Section "${op.sectionId}" is type "${found.section.type}", not "${op.sectionType}".`,
      "sectionType",
    );
  }

  const candidate: BaseSection = {
    ...found.section,
    type: op.sectionType,
    props: op.nextProps,
  };
  const parsed = AnySectionSchema.safeParse(candidate);
  if (!parsed.success) {
    return opError(
      op,
      `Invalid props for "${op.sectionType}" section: ${formatZodIssues(parsed.error)}`,
      "nextProps",
    );
  }

  const next = parsed.data;
  const changed = JSON.stringify(next.props) !== JSON.stringify(found.section.props);
  const warnings = preserveWarnings(found.section.props as Record<string, unknown>, next.props, op.sectionId);

  const updated = cloneProject(project);
  const page = findPage(updated, op.pageId)!;
  const idx = page.sections.findIndex((s) => s.id === op.sectionId);
  page.sections[idx] = next as BaseSection;
  return { ok: true, project: updated, changed, warnings };
}

function applyUpdateSectionStyles(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-section-styles" }>,
): ApplyResult {
  const found = findSection(project, op.pageId, op.sectionId);
  if (!found) {
    const page = findPage(project, op.pageId);
    if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");
    return opError(op, `Section "${op.sectionId}" does not exist on page "${op.pageId}".`, "sectionId");
  }
  const nextStyles = { ...found.section.styles, ...op.nextStyles };
  const changed = JSON.stringify(nextStyles) !== JSON.stringify(found.section.styles);
  const updated = cloneProject(project);
  const page = findPage(updated, op.pageId)!;
  const idx = page.sections.findIndex((s) => s.id === op.sectionId);
  page.sections[idx] = { ...page.sections[idx], styles: nextStyles };
  return { ok: true, project: updated, changed };
}

function applyInsertSection(
  project: Project,
  op: Extract<AiEditOperation, { type: "insert-section" }>,
): ApplyResult {
  const page = findPage(project, op.pageId);
  if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");

  if (page.sections.some((s) => s.id === op.section.id)) {
    return opError(op, `Section ID "${op.section.id}" already exists on page "${op.pageId}".`, "section.id");
  }
  // ID must also be unique across the whole project (sections are addressable
  // by id from anywhere).
  const allIds = project.pages.flatMap((p) => p.sections.map((s) => s.id));
  if (allIds.includes(op.section.id)) {
    return opError(op, `Section ID "${op.section.id}" already exists in the project.`, "section.id");
  }

  if (isSingletonSectionType(op.section.type) && page.sections.some((s) => s.type === op.section.type)) {
    return opError(
      op,
      `A "${op.section.type}" section already exists on page "${op.pageId}" (singleton policy).`,
      "section.type",
    );
  }

  const sectionValidation = AnySectionSchema.safeParse(op.section);
  if (!sectionValidation.success) {
    return opError(
      op,
      `Inserted section failed validation: ${formatZodIssues(sectionValidation.error)}`,
      "section",
    );
  }

  const insertResult = insertSectionAt({
    sections: page.sections,
    section: sectionValidation.data as BaseSection,
    position: op.position,
  });
  if (!insertResult.ok) {
    return opError(op, insertResult.error.message, "position");
  }

  const ordered = normalizeSectionOrders(insertResult.value.sections);
  const updated = cloneProject(project);
  const target = findPage(updated, op.pageId)!;
  target.sections = ordered;
  return {
    ok: true,
    project: updated,
    changed: true,
    detail: `Inserted ${op.sectionType} section at position ${insertResult.value.index}`,
  };
}

function applyDeleteSection(
  project: Project,
  op: Extract<AiEditOperation, { type: "delete-section" }>,
): ApplyResult {
  const found = findSection(project, op.pageId, op.sectionId);
  if (!found) {
    const page = findPage(project, op.pageId);
    if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");
    return opError(op, `Section "${op.sectionId}" does not exist on page "${op.pageId}".`, "sectionId");
  }
  if (found.page.sections.length <= 1) {
    return opError(op, "A page must keep at least one section — cannot delete the last section.", "sectionId");
  }

  const updated = cloneProject(project);
  const target = findPage(updated, op.pageId)!;
  target.sections = normalizeSectionOrders(
    target.sections.filter((s) => s.id !== op.sectionId),
  );
  return { ok: true, project: updated, changed: true, detail: `Deleted ${found.section.type} section` };
}

function applyDuplicateSection(
  project: Project,
  op: Extract<AiEditOperation, { type: "duplicate-section" }>,
): ApplyResult {
  const found = findSection(project, op.pageId, op.sectionId);
  if (!found) {
    const page = findPage(project, op.pageId);
    if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");
    return opError(op, `Section "${op.sectionId}" does not exist on page "${op.pageId}".`, "sectionId");
  }
  if (isSingletonSectionType(found.section.type)) {
    return opError(op, `"${found.section.type}" sections cannot be duplicated (singleton policy).`, "sectionId");
  }
  if (found.page.sections.some((s) => s.id === op.newSectionId)) {
    return opError(op, `Section ID "${op.newSectionId}" already exists on page "${op.pageId}".`, "newSectionId");
  }
  const allIds = project.pages.flatMap((p) => p.sections.map((s) => s.id));
  if (allIds.includes(op.newSectionId)) {
    return opError(op, `Section ID "${op.newSectionId}" already exists in the project.`, "newSectionId");
  }

  const clone = { ...deepClone(found.section), id: op.newSectionId } as BaseSection;
  const validation = AnySectionSchema.safeParse(clone);
  if (!validation.success) {
    return opError(op, `Duplicated section failed validation: ${formatZodIssues(validation.error)}`, "sectionId");
  }

  const sourceIndex = found.page.sections.findIndex((s) => s.id === op.sectionId);
  const next = [...found.page.sections];
  next.splice(sourceIndex + 1, 0, validation.data as BaseSection);
  const ordered = normalizeSectionOrders(next);

  const updated = cloneProject(project);
  const target = findPage(updated, op.pageId)!;
  target.sections = ordered;
  return { ok: true, project: updated, changed: true, detail: `Duplicated ${found.section.type} section` };
}

function applyMoveSection(
  project: Project,
  op: Extract<AiEditOperation, { type: "move-section" }>,
): ApplyResult {
  const page = findPage(project, op.pageId);
  if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");
  const result = moveSectionToIndex({
    sections: page.sections,
    sectionId: op.sectionId,
    targetIndex: op.targetIndex,
  });
  if (!result.ok) return opError(op, result.error.message, "targetIndex");

  const ordered = normalizeSectionOrders(result.value.sections);
  const updated = cloneProject(project);
  const target = findPage(updated, op.pageId)!;
  target.sections = ordered;
  return {
    ok: true,
    project: updated,
    changed: result.value.changed,
    detail: result.value.changed
      ? `Moved section "${op.sectionId}" to index ${result.value.activeIndex}`
      : `Section "${op.sectionId}" is already at index ${op.targetIndex}`,
  };
}

function applySetVisibility(
  project: Project,
  op: Extract<AiEditOperation, { type: "set-section-visibility" }>,
): ApplyResult {
  const found = findSection(project, op.pageId, op.sectionId);
  if (!found) {
    const page = findPage(project, op.pageId);
    if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");
    return opError(op, `Section "${op.sectionId}" does not exist on page "${op.pageId}".`, "sectionId");
  }
  if (found.section.visible === op.visible) {
    return { ok: true, project, changed: false };
  }
  const updated = cloneProject(project);
  const target = findPage(updated, op.pageId)!;
  const idx = target.sections.findIndex((s) => s.id === op.sectionId);
  target.sections[idx] = { ...target.sections[idx], visible: op.visible };
  return {
    ok: true,
    project: updated,
    changed: true,
    detail: op.visible ? `Section "${op.sectionId}" is now visible` : `Section "${op.sectionId}" is now hidden`,
  };
}

function applyAddPage(
  project: Project,
  op: Extract<AiEditOperation, { type: "add-page" }>,
): ApplyResult {
  if (project.pages.some((p) => p.id === op.page.id)) {
    return opError(op, `Page ID "${op.page.id}" already exists.`, "page.id");
  }
  if (project.pages.some((p) => p.slug === op.page.slug)) {
    return opError(op, `Slug "${op.page.slug}" is already in use by another page.`, "page.slug");
  }
  if (op.page.sections.length < 1) {
    return opError(op, "Added pages must contain at least one section.", "page.sections");
  }
  for (const section of op.page.sections) {
    const validation = AnySectionSchema.safeParse(section);
    if (!validation.success) {
      return opError(
        op,
        `Section "${section.id}" in added page failed validation: ${formatZodIssues(validation.error)}`,
        "page.sections",
      );
    }
  }

  const normalizedPage = {
    ...op.page,
    sections: normalizeSectionOrders(op.page.sections as BaseSection[]),
  };

  const pages = [...project.pages];
  const position = op.position ?? pages.length;
  const clamped = Math.max(0, Math.min(position, pages.length));
  pages.splice(clamped, 0, normalizedPage);

  const updated = cloneProject(project);
  updated.pages = pages;
  return { ok: true, project: updated, changed: true, detail: `Added page "${op.page.title}" at index ${clamped}` };
}

function applyRenamePage(
  project: Project,
  op: Extract<AiEditOperation, { type: "rename-page" }>,
): ApplyResult {
  const titleValidation = validatePageTitle(op.title);
  if (!titleValidation.valid) {
    return opError(op, titleValidation.error ?? "Invalid page title.", "title");
  }
  const result = renamePageInList({
    pages: project.pages,
    pageId: op.pageId,
    title: op.title,
  });
  if (!result.ok) return opError(op, result.error.message, "pageId");

  const updated = cloneProject(project);
  updated.pages = result.value.pages;
  return {
    ok: true,
    project: updated,
    changed: result.value.changed,
    detail: result.value.changed ? `Renamed page to "${op.title.trim()}"` : "Page name unchanged",
  };
}

function applyDeletePage(
  project: Project,
  op: Extract<AiEditOperation, { type: "delete-page" }>,
): ApplyResult {
  const result = deletePageFromList(project.pages, op.pageId);
  if (!result.ok) return opError(op, result.error.message, "pageId");

  const updated = cloneProject(project);
  updated.pages = result.value.pages;
  return { ok: true, project: updated, changed: true, detail: `Deleted page "${op.pageId}"` };
}

function applyMovePage(
  project: Project,
  op: Extract<AiEditOperation, { type: "move-page" }>,
): ApplyResult {
  const result = movePageToIndex(project.pages, op.pageId, op.targetIndex);
  if (!result.ok) return opError(op, result.error.message, "targetIndex");

  const updated = cloneProject(project);
  updated.pages = result.value.pages;
  return {
    ok: true,
    project: updated,
    changed: result.value.changed,
    detail: result.value.changed
      ? `Moved page "${op.pageId}" to index ${result.value.activeIndex}`
      : `Page "${op.pageId}" is already at index ${op.targetIndex}`,
  };
}

function applyUpdatePageMeta(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-page-meta" }>,
): ApplyResult {
  const page = findPage(project, op.pageId);
  if (!page) return opError(op, `Page "${op.pageId}" does not exist.`, "pageId");

  const sanitized = sanitizePageMeta(op.meta);
  const current = page.meta ?? {};
  const changed =
    JSON.stringify(sanitized) !== JSON.stringify(current);

  const updated = cloneProject(project);
  const target = findPage(updated, op.pageId)!;
  target.meta = sanitized;
  return { ok: true, project: updated, changed, detail: changed ? "Updated page metadata" : "Page metadata unchanged" };
}

// ---------------------------------------------------------------------------
// Element operations (Phase P22-H) — custom-block element trees only
//
// Every element op is executed through the canonical applyElementOperation
// engine and materializes/folds through sectionToElementTree /
// elementTreeToSection. Targets are restricted to CUSTOM-BLOCK sections (the
// durable element-tree surface); regular sections are rejected rather than
// silently dropping element metadata after persistence.
// ---------------------------------------------------------------------------

/** Narrow the engine's union result to the tree (duplicate returns {tree,newId}). */
function unwrapElementResult(
  result: ElementResult<ElementTree | { tree: ElementTree; newId: string }>,
): ElementResult<ElementTree> {
  if (!result.ok) return result;
  const value = result.value;
  if (value !== null && typeof value === "object" && "tree" in value && value.tree) {
    return { ok: true, value: value.tree };
  }
  return { ok: true, value: value as ElementTree };
}

function applyElementOp(
  project: Project,
  op: AiEditOperation,
  target: { pageId: string; sectionId: string; elementId?: string },
  applyFn: (tree: ElementTree) => ElementResult<ElementTree>,
  detail?: string,
  errorField = "elementId",
): ApplyResult {
  const found = findSection(project, target.pageId, target.sectionId);
  if (!found) {
    const page = findPage(project, target.pageId);
    if (!page) return opError(op, `Page "${target.pageId}" does not exist.`, "pageId");
    return opError(op, `Section "${target.sectionId}" does not exist on page "${target.pageId}".`, "sectionId");
  }
  const section = found.section;
  if (!isCustomBlockSection(section)) {
    return opError(
      op,
      "Element editing is only supported inside custom-block sections.",
      "sectionId",
    );
  }
  const tree = sectionToElementTree(section);
  if (target.elementId !== undefined && !tree.nodes[target.elementId]) {
    return opError(
      op,
      `Element "${target.elementId}" does not exist on section "${target.sectionId}".`,
      "elementId",
    );
  }
  const applied = applyFn(tree);
  if (!applied.ok) {
    return opError(op, applied.error.message, errorField);
  }
  const folded = elementTreeToSection(applied.value, section);
  if (!folded.ok) {
    return opError(op, folded.error.message, "tree");
  }
  const changed =
    JSON.stringify(folded.value.section.props) !== JSON.stringify(section.props);
  if (!changed) {
    return { ok: true, project, changed: false, detail: "Element unchanged" };
  }
  const updated = cloneProject(project);
  const page = findPage(updated, target.pageId)!;
  const idx = page.sections.findIndex((s) => s.id === target.sectionId);
  page.sections[idx] = {
    ...page.sections[idx],
    props: folded.value.section.props,
    styles: folded.value.section.styles,
  };
  return { ok: true, project: updated, changed: true, detail };
}

function applyUpdateElementProps(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-element-props" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "update-props",
          elementId: op.elementId,
          props: op.props,
        }),
      ),
    "Updated element content",
  );
}

function applyUpdateElementStyle(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-element-style" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "update-style",
          elementId: op.elementId,
          style: op.style,
        }),
      ),
    "Updated element style",
  );
}

function applyUpdateElementResponsive(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-element-responsive" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "update-viewport",
          elementId: op.elementId,
          viewport: op.breakpoint,
          style: op.style,
        }),
      ),
    `Updated ${op.breakpoint} responsive overrides`,
  );
}

function applyUpdateElementAnimation(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-element-animation" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "update-animation",
          elementId: op.elementId,
          animation: op.animation,
        }),
      ),
    op.animation === null ? "Cleared element animation" : "Updated element animation",
  );
}

function applyUpdateElementInteraction(
  project: Project,
  op: Extract<AiEditOperation, { type: "update-element-interaction" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "update-interaction",
          elementId: op.elementId,
          interaction: op.interaction,
        }),
      ),
    op.interaction === null ? "Cleared element interactions" : "Updated element interactions",
  );
}

function applyInsertElement(
  project: Project,
  op: Extract<AiEditOperation, { type: "insert-element" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId },
    (tree) => {
      const parentId = op.parentElementId ?? tree.rootIds[0];
      if (!tree.nodes[parentId]) {
        return {
          ok: false,
          error: {
            code: "ELEMENT_TARGET_NOT_FOUND",
            message: `Parent element "${parentId}" does not exist.`,
          },
        };
      }
      if (!isRenderableElementType(op.elementType)) {
        return {
          ok: false,
          error: {
            code: "ELEMENT_TYPE_NOT_REGISTERED",
            message: `"${op.elementType}" is not a registered renderable element.`,
          },
        };
      }
      // Registry/factory defaults + bounded AI content — never fabricated JSON.
      const element = createElement(op.elementType as ElementType, {
        props: op.props,
        style: op.style,
      });
      return unwrapElementResult(
        applyElementOperation(tree, {
          kind: "insert",
          parentId,
          element,
          index: op.index,
        }),
      );
    },
    `Inserted ${op.elementType} element`,
    "parentElementId",
  );
}

function applyDeleteElement(
  project: Project,
  op: Extract<AiEditOperation, { type: "delete-element" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "delete",
          elementId: op.elementId,
        }),
      ),
    `Deleted element "${op.elementId}"`,
  );
}

function applyDuplicateElement(
  project: Project,
  op: Extract<AiEditOperation, { type: "duplicate-element" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "duplicate",
          elementId: op.elementId,
        }),
      ),
    `Duplicated element "${op.elementId}"`,
  );
}

function applySetElementVisibility(
  project: Project,
  op: Extract<AiEditOperation, { type: "set-element-visibility" }>,
): ApplyResult {
  return applyElementOp(
    project,
    op,
    { pageId: op.pageId, sectionId: op.sectionId, elementId: op.elementId },
    (tree) =>
      unwrapElementResult(
        applyElementOperation(tree, {
          kind: "set-visible",
          elementId: op.elementId,
          visible: op.visible,
        }),
      ),
    op.visible ? `Element "${op.elementId}" is now visible` : `Element "${op.elementId}" is now hidden`,
  );
}

function applyOperation(project: Project, op: AiEditOperation): ApplyResult {
  switch (op.type) {
    case "update-section-props":
      return applyUpdateSectionProps(project, op);
    case "update-section-styles":
      return applyUpdateSectionStyles(project, op);
    case "insert-section":
      return applyInsertSection(project, op);
    case "delete-section":
      return applyDeleteSection(project, op);
    case "duplicate-section":
      return applyDuplicateSection(project, op);
    case "move-section":
      return applyMoveSection(project, op);
    case "set-section-visibility":
      return applySetVisibility(project, op);
    case "add-page":
      return applyAddPage(project, op);
    case "rename-page":
      return applyRenamePage(project, op);
    case "delete-page":
      return applyDeletePage(project, op);
    case "move-page":
      return applyMovePage(project, op);
    case "update-page-meta":
      return applyUpdatePageMeta(project, op);
    // Phase P22-H — element operations
    case "update-element-props":
      return applyUpdateElementProps(project, op);
    case "update-element-style":
      return applyUpdateElementStyle(project, op);
    case "update-element-responsive":
      return applyUpdateElementResponsive(project, op);
    case "update-element-animation":
      return applyUpdateElementAnimation(project, op);
    case "update-element-interaction":
      return applyUpdateElementInteraction(project, op);
    case "insert-element":
      return applyInsertElement(project, op);
    case "delete-element":
      return applyDeleteElement(project, op);
    case "duplicate-element":
      return applyDuplicateElement(project, op);
    case "set-element-visibility":
      return applySetElementVisibility(project, op);
    default:
      return opError(op, `Unsupported operation type "${(op as { type: string }).type}".`);
  }
}

// ---------------------------------------------------------------------------
// Final project validation — mirrors export/store invariants
// ---------------------------------------------------------------------------

function validateFinalProject(project: Project): { ok: true } | { ok: false; message: string } {
  const projectResult = ProjectSchema.safeParse(project);
  if (!projectResult.success) {
    return { ok: false, message: `Project validation: ${formatZodIssues(projectResult.error)}` };
  }

  for (const page of project.pages) {
    for (const section of page.sections) {
      const result = AnySectionSchema.safeParse(section);
      if (!result.success) {
        return {
          ok: false,
          message: `Section "${section.id}" (${section.type}) on page "${page.id}" failed validation: ${formatZodIssues(result.error)}`,
        };
      }
    }
  }

  const routingErrors = validateRoutingForExport(project.pages);
  if (routingErrors.length > 0) {
    return { ok: false, message: `Routing validation: ${routingErrors.join("; ")}` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SimulatePlanOptions {
  /** Capture a project snapshot before each operation (used for diffs). Default true. */
  captureSnapshots?: boolean;
}

export function simulatePlan(
  source: Project,
  operations: AiEditOperation[],
  options?: SimulatePlanOptions,
): SimulatePlanResult {
  const capture = options?.captureSnapshots !== false;

  if (operations.length === 0) {
    return {
      ok: true,
      project: cloneProject(source),
      operationResults: [],
      warnings: [],
      snapshots: capture ? [cloneProject(source)] : [],
    };
  }

  let current = cloneProject(source);
  const snapshots: Project[] = capture ? [cloneProject(current)] : [];
  const operationResults: AiOperationSimulationResult[] = [];
  const warnings: AiEditWarning[] = [];

  for (const op of operations) {
    const result = applyOperation(current, op);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        failedOperationId: op.id,
      };
    }
    current = result.project;
    operationResults.push({
      operationId: op.id,
      ok: true,
      kind: result.changed ? "applied" : "no-op",
      detail: result.detail,
    });
    if (result.warnings) warnings.push(...result.warnings);
    if (capture) snapshots.push(cloneProject(current));
  }

  const finalValidation = validateFinalProject(current);
  if (!finalValidation.ok) {
    return {
      ok: false,
      error: {
        code: "PLAN_SIMULATION_FAILED",
        message: finalValidation.message,
      },
    };
  }

  return { ok: true, project: current, operationResults, warnings, snapshots };
}

/** Convenience: simulate and return only the resulting project. */
export function simulateProjectResult(
  source: Project,
  operations: AiEditOperation[],
): { ok: true; project: Project } | { ok: false; error: AiEditPlanError; failedOperationId?: string } {
  const result = simulatePlan(source, operations, { captureSnapshots: false });
  if (result.ok) return { ok: true, project: result.project };
  return { ok: false, error: result.error, failedOperationId: result.failedOperationId };
}

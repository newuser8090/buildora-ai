// ---------------------------------------------------------------------------
// Rule-based planner — deterministic AI edit plan fallback
//
// Covers the common command set deterministically:
//   add/delete/duplicate/move/hide/show section, add/rename/delete/move page,
//   page tone rewrite, project tone rewrite.
//
// Guarantees (spec §13):
//   - deterministic — no random IDs without an injected factory
//   - preserves section/page references, links, prices, plan names, AssetRefs
//   - produces valid schemas (validated by the orchestrator + simulator)
//   - structured warnings for ambiguous commands
//   - refuses destructive ambiguity (e.g. multiple matching sections)
//   - never mutates the input project
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import type { Page, Project } from "@/types/project";
import type {
  AiEditOperation,
  AiEditPlan,
  AiEditPlanner,
  AiEditPlannerInput,
  AiEditPlannerResult,
  AiEditScope,
  AiEditWarning,
  SectionInsertPosition,
} from "../plan-types";
import { scopeLabel } from "../plan-types";
import { applyRuleBasedEdit, detectTone, type ToneKey } from "../rules/rule-based-editor";
import { SectionFactory, type SectionIdFactory } from "@/features/editor/section-library/services/section-factory";
import { registerDefaultSectionLibrary } from "@/features/editor/section-library/registry/register-default-section-library";
import { normalizeSectionType, SUPPORTED_SECTION_TYPES } from "@/features/generation/providers/generation-provider";
import { createPageId, resolveUniqueSlug, validatePageTitle } from "@/features/editor/store/page-structure";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import type { ElementNode, ElementStyleTokens, ElementTree } from "@/features/elements/types";
import type { ElementAnimation } from "@/features/elements/animation/types";
import type { ElementInteraction } from "@/features/elements/interaction/types";
import type { ElementPlanBreakpoint } from "../plan-types";
import type { EditTarget } from "../types";

// ---------------------------------------------------------------------------
// IDs — injectable for deterministic tests
// ---------------------------------------------------------------------------

export interface PlanIdFactory {
  planId(): string;
  pageId(): string;
  sectionId(type: string): string;
  operationId(index: number): string;
}

let idCounter = 0;

export function createDefaultPlanIdFactory(): PlanIdFactory {
  return {
    planId: () => `plan-${Date.now().toString(36)}-${(idCounter += 1)}`,
    pageId: () => createPageId(),
    sectionId: (type) => `sec-${type}-${Date.now().toString(36)}-${(idCounter += 1)}`,
    operationId: (index) => `op-${index + 1}-${Date.now().toString(36)}`,
  };
}

// ---------------------------------------------------------------------------
// Section keyword resolution
// ---------------------------------------------------------------------------

const SECTION_KEYWORDS: Array<[string[], string]> = [
  [["faq", "frequently asked", "questions", "q&a"], "faq"],
  [["cta", "call to action", "call-to-action", "callout"], "cta"],
  [["pricing", "price", "prices", "plans", "plan", "packages"], "pricing"],
  [["hero", "headline", "banner", "introduction", "intro"], "hero"],
  [
    ["features", "feature", "services", "service", "testimonials", "testimonial", "reviews", "stats", "about", "team", "gallery", "logos", "process"],
    "features",
  ],
  [["header", "nav", "navigation", "navbar", "menu"], "header"],
  [["footer", "foot", "footnote"], "footer"],
];

/** Map a natural-language keyword to a supported section type, or null. */
export function resolveSectionTypeKeyword(keyword: string): string | null {
  const lower = keyword.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ");
  for (const [words, type] of SECTION_KEYWORDS) {
    if (words.includes(lower)) return type;
    if (words.some((w) => lower.includes(w) || w.includes(lower))) return type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Page resolution
// ---------------------------------------------------------------------------

function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Resolve pages whose title matches a keyword. Exact match wins. */
export function resolvePagesByKeyword(pages: Page[], keyword: string): Page[] {
  const lower = normalizeKeyword(keyword);
  if (lower === "homepage" || lower === "home" || lower === "home page") {
    return pages.slice(0, 1);
  }
  const exact = pages.filter((p) => normalizeKeyword(p.title) === lower);
  if (exact.length > 0) return exact;
  return pages.filter(
    (p) => normalizeKeyword(p.title).includes(lower) || lower.includes(normalizeKeyword(p.title)),
  );
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

class PlanBuilder {
  readonly input: AiEditPlannerInput;
  readonly operations: AiEditOperation[] = [];
  readonly warnings: AiEditWarning[] = [];
  readonly idFactory: PlanIdFactory;
  readonly sectionFactory: SectionFactory;
  private opCounter = 0;

  constructor(input: AiEditPlannerInput, idFactory: PlanIdFactory) {
    this.input = input;
    this.idFactory = idFactory;
    this.sectionFactory = new SectionFactory({
      idFactory: ((type) => this.idFactory.sectionId(type)) as SectionIdFactory,
    });
  }

  warn(code: string, message: string): void {
    this.warnings.push({ code, message });
  }

  nextOperationId(): string {
    this.opCounter += 1;
    return this.idFactory.operationId(this.opCounter);
  }

  /** Pages in scope for section-level resolution. */
  scopePages(): Page[] {
    const { scope, project } = this.input;
    if (scope.type === "project") return project.pages;
    const page = project.pages.find((p) => p.id === scope.pageId);
    return page ? [page] : [];
  }

  /** The page a section- or element-scope plan resolves to. */
  sectionScopePage(): Page | undefined {
    const { scope, project } = this.input;
    if (scope.type !== "section" && scope.type !== "element") return undefined;
    return project.pages.find((p) => p.id === scope.pageId);
  }

  /**
   * Phase P22-H — resolve the element scope's target (page/section/node).
   * Returns null when the scope is not element or the element is gone.
   */
  elementScopeTarget(): {
    page: Page;
    section: BaseSection;
    elementId: string;
    node: ElementNode;
    tree: ElementTree;
  } | null {
    const { scope, project } = this.input;
    if (scope.type !== "element") return null;
    const page = project.pages.find((p) => p.id === scope.pageId);
    if (!page) return null;
    const section = page.sections.find((s) => s.id === scope.sectionId);
    if (!section) return null;
    const tree = sectionToElementTree(section);
    const node = tree.nodes[scope.elementId];
    if (!node) return null;
    return { page, section, elementId: scope.elementId, node, tree };
  }

  /**
   * Resolve sections matching a keyword within scope. Returns matches with
   * their page, or an empty array. Optionally ordinal-indexed ("second hero").
   */
  resolveSections(
    keyword: string,
    ordinal?: string,
  ): Array<{ page: Page; index: number; section: BaseSection }> {
    const type = resolveSectionTypeKeyword(keyword);
    const pages = this.scopePages();
    if (!type) return [];
    const matches: Array<{ page: Page; index: number; section: BaseSection }> = [];
    for (const page of pages) {
      page.sections.forEach((section, index) => {
        if (section.type === type) matches.push({ page, index, section });
      });
    }
    if (ordinal) {
      const ordinalIndex = ordinalToIndex(ordinal);
      if (ordinalIndex === null || ordinalIndex < 1 || ordinalIndex > matches.length) return [];
      return [matches[ordinalIndex - 1]];
    }
    return matches;
  }

  buildSection(type: string): BaseSection | null {
    const result = this.sectionFactory.create({ type: type as never });
    if (!result.ok) {
      this.warn("SECTION_CREATION_FAILED", `Could not create a "${type}" section: ${result.error.message}`);
      return null;
    }
    return result.section;
  }

  /** Resolve an anchor section keyword to a position specifier for inserts. */
  resolvePosition(relation: string, anchorKeyword: string): SectionInsertPosition | null {
    const matches = this.resolveSections(anchorKeyword);
    if (matches.length === 0) {
      this.warn(
        "ANCHOR_NOT_FOUND",
        `Could not find a "${anchorKeyword}" section to position against — appending at the end instead.`,
      );
      return { type: "end" };
    }
    if (matches.length > 1) {
      this.warn(
        "AMBIGUOUS_ANCHOR",
        `Multiple "${anchorKeyword}" sections found — positioning relative to the first match.`,
      );
    }
    const anchorId = matches[0].section.id;
    return relation === "above" || relation === "before"
      ? { type: "before", sectionId: anchorId }
      : { type: "after", sectionId: anchorId };
  }

  /** Brand context extracted from the project name for copy rewrites. */
  brandContext(): { brandName?: string } {
    return { brandName: this.input.project.name.split(" — ")[0] || this.input.project.name };
  }
}

function ordinalToIndex(word: string): number | null {
  const map: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    last: -1,
  };
  if (map[word] !== undefined) return map[word] === -1 ? Infinity : map[word];
  return null;
}

// ---------------------------------------------------------------------------
// Recognizers — each returns operations/warnings or null when it does not
// apply. All recognizers run so multi-command instructions ("Add a Contact
// page, rename Pricing to Plans, and hide FAQ on Home") produce several ops.
// ---------------------------------------------------------------------------

interface RecognizerResult {
  operations: AiEditOperation[];
}

type Recognizer = (input: AiEditPlannerInput, b: PlanBuilder) => RecognizerResult;

function opBase(
  b: PlanBuilder,
  type: AiEditOperation["type"],
  risk: AiEditOperation["risk"],
  label: string,
  explanation: string,
): { id: string; type: AiEditOperation["type"]; risk: AiEditOperation["risk"]; label: string; explanation: string } {
  return { id: b.nextOperationId(), type, risk, label, explanation };
}

// ---- 1. Rename page ------------------------------------------------------

const renamePageRecognizer: Recognizer = (input, b) => {
  const match = input.instruction.match(
    /rename\s+(.+?)\s+to\s+(.+?)(?=,|\s+and\s+|\s+(?:hide|show|delete|move|add|make|improve)\b|$)/i,
  );
  if (!match) return { operations: [] };
  const sourceKeyword = match[1].trim();
  const newTitle = match[2].trim();

  const pages = resolvePagesByKeyword(input.project.pages, sourceKeyword);
  if (pages.length === 0) {
    b.warn("PAGE_NOT_FOUND", `Could not find a page matching "${sourceKeyword}" to rename.`);
    return { operations: [] };
  }
  if (pages.length > 1) {
    b.warn("AMBIGUOUS_PAGE", `Multiple pages match "${sourceKeyword}" — rename requires a unique page.`);
    return { operations: [] };
  }
  const titleValidation = validatePageTitle(newTitle);
  if (!titleValidation.valid) {
    b.warn("INVALID_PAGE_TITLE", titleValidation.error ?? `"${newTitle}" is not a valid page name.`);
    return { operations: [] };
  }
  const page = pages[0];
  const base = opBase(b, "rename-page", "low", `Rename ${page.title} to ${newTitle.trim()}`, `Renames the "${page.title}" page and re-derives its route.`);
  return {
    operations: [
      { ...base, type: "rename-page", pageId: page.id, title: newTitle.trim() },
    ],
  };
};

// ---- 2. Add page ----------------------------------------------------------

// Multi-command support: "Add a Contact page, rename Pricing to Plans, and
// hide FAQ on Home" — the page title stops at a comma or a command keyword,
// while "with a hero, features, FAQ, and CTA" keeps its comma-separated list.
const COMMAND_WORD = "rename|hide|show|delete|remove|duplicate|move|add|create|make|improve|rewrite";
const ADD_PAGE_RE = new RegExp(
  `(?:add|create)\\s+(?:a|an|another|one|new)?\\s*([\\w\\-\\s]+?)\\s+page(?:\\s+with\\s+([\\w,\\s\\-]+?))?(?=$|\\s+(?:${COMMAND_WORD})\\b|,\\s*(?:${COMMAND_WORD}))`,
  "i",
);

const addPageRecognizer: Recognizer = (input, b) => {
  const match = input.instruction.match(ADD_PAGE_RE);
  if (!match) return { operations: [] };
  const title = match[1].trim();
  if (!validatePageTitle(title).valid) {
    b.warn("INVALID_PAGE_TITLE", `"${title}" is not a valid page name.`);
    return { operations: [] };
  }

  // Optional "with a hero, features, FAQ, and CTA" section list.
  const sectionTypes: string[] = [];
  if (match[2]) {
    const raw = match[2].replace(/\band\b/gi, ",");
    for (const part of raw.split(",")) {
      const item = part.trim().replace(/^(?:a|an|the)\s+/i, "").toLowerCase();
      if (!item) continue;
      const type = resolveSectionTypeKeyword(item);
      if (type) {
        sectionTypes.push(type);
      } else {
        const normalized = normalizeSectionType(item);
        b.warn(
          "UNSUPPORTED_SECTION_TYPE",
          `"${item}" is not a supported section type — using "${normalized}" instead.`,
        );
        sectionTypes.push(normalized);
      }
    }
  }

  const pageId = b.idFactory.pageId();
  const slug = resolveUniqueSlug(input.project.pages, title);
  const heroSection = b.buildSection("hero");
  const sections: BaseSection[] = heroSection ? [heroSection] : [];
  for (const type of sectionTypes) {
    const section = b.buildSection(type);
    if (section) sections.push(section);
  }
  if (sections.length === 0) return { operations: [] };

  const page: Page = {
    id: pageId,
    title: title.trim(),
    slug,
    sections: sections.map((s, i) => ({ ...s, order: i + 1 })),
  };

  const base = opBase(b, "add-page", "low", `Add "${title}" page`, `Creates a new "${title}" page at "${slug}" with ${sections.length} section(s).`);
  return { operations: [{ ...base, type: "add-page", page }] };
};

// ---- 3. Delete page --------------------------------------------------------

const DELETE_PAGE_RE = /(?:delete|remove)\s+(?:the|this)?\s*([\w\-\s]+?)\s+page/i;

const deletePageRecognizer: Recognizer = (input, b) => {
  const match = input.instruction.match(DELETE_PAGE_RE);
  if (!match) return { operations: [] };
  const pages = resolvePagesByKeyword(input.project.pages, match[1].trim());
  if (pages.length === 0) {
    b.warn("PAGE_NOT_FOUND", `Could not find a page matching "${match[1].trim()}" to delete.`);
    return { operations: [] };
  }
  if (pages.length > 1) {
    b.warn("AMBIGUOUS_PAGE", `Multiple pages match "${match[1].trim()}" — deletion requires a unique page.`);
    return { operations: [] };
  }
  const page = pages[0];
  if (input.project.pages.length <= 1) {
    b.warn("LAST_PAGE", "A project must keep at least one page — the last page cannot be deleted.");
    return { operations: [] };
  }
  const base = opBase(b, "delete-page", "high", `Delete "${page.title}" page`, `Permanently removes the "${page.title}" page and all of its sections.`);
  return { operations: [{ ...base, type: "delete-page", pageId: page.id }] };
};

// ---- 4. Move page ----------------------------------------------------------

const MOVE_PAGE_RE = /move\s+(?:the|this)?\s*([\w\-\s]+?)\s+page\s+(above|below|before|after)\s+(?:the|this)?\s*([\w\-\s]+?)(?:\s+page)?$/i;

const movePageRecognizer: Recognizer = (input, b) => {
  const match = input.instruction.match(MOVE_PAGE_RE);
  if (!match) return { operations: [] };
  const sourcePages = resolvePagesByKeyword(input.project.pages, match[1].trim());
  const targetPages = resolvePagesByKeyword(input.project.pages, match[3].trim());
  if (sourcePages.length !== 1 || targetPages.length !== 1) {
    b.warn("AMBIGUOUS_PAGE", "Moving a page requires exactly one matching source and target page.");
    return { operations: [] };
  }
  const source = sourcePages[0];
  const target = targetPages[0];
  const relation = match[2].toLowerCase();
  const targetIndex = input.project.pages.findIndex((p) => p.id === target.id);
  const offset = relation === "below" || relation === "after" ? 1 : 0;
  const base = opBase(b, "move-page", "low", `Move "${source.title}" ${relation} "${target.title}"`, `Reorders the "${source.title}" page.`);
  return {
    operations: [
      {
        ...base,
        type: "move-page",
        pageId: source.id,
        targetIndex: Math.max(0, Math.min(targetIndex + offset, input.project.pages.length - 1)),
      },
    ],
  };
};

// ---- 5. Add section ---------------------------------------------------------

const ADD_SECTION_RE = /add\s+(?:a|an|another|one|new)?\s*([\w\-\s]+?)\s+section/i;

const addSectionRecognizer: Recognizer = (input, b) => {
  const match = input.instruction.match(ADD_SECTION_RE);
  if (!match) return { operations: [] };
  const keyword = match[1].trim();
  const isCanonical = (SUPPORTED_SECTION_TYPES as readonly string[]).includes(
    keyword.toLowerCase().trim(),
  );
  let type = resolveSectionTypeKeyword(keyword);
  if (!type) {
    // Unsupported request → map to a supported type with a warning.
    const normalized = normalizeSectionType(keyword);
    b.warn(
      "UNSUPPORTED_SECTION_TYPE",
      `"${keyword}" is not a supported section type — using "${normalized}" with generic content instead.`,
    );
    type = normalized;
  } else if (!isCanonical) {
    // Aliased keyword (e.g. "testimonials" → features): keep the mapping but
    // surface it so the user understands the closest supported type was used.
    b.warn(
      "UNSUPPORTED_SECTION_TYPE",
      `"${keyword}" is not a first-class section type — using "${type}" with standard content instead.`,
    );
  }

  const pages = b.scopePages();
  if (pages.length === 0) {
    b.warn("SCOPE_INVALID", "No page is in scope for adding a section.");
    return { operations: [] };
  }
  const page = pages[0];

  // Position: "below pricing" / "above the FAQ" / "before X" / "after X".
  const positionMatch = input.instruction.match(
    /(above|below|before|after)\s+(?:the|this)?\s*([\w\-\s]+?)(?:\s+section)?$/i,
  );
  let position: SectionInsertPosition | null = { type: "end" };
  if (positionMatch) {
    const relation = positionMatch[1].toLowerCase();
    position = b.resolvePosition(relation, positionMatch[2].trim());
  }
  if (!position) position = { type: "end" };

  const section = b.buildSection(type);
  if (!section) return { operations: [] };

  const base = opBase(
    b,
    "insert-section",
    "low",
    `Add ${type} section`,
    position.type === "end"
      ? `Adds a new "${type}" section at the end of the page.`
      : `Adds a new "${type}" section ${position.type} the anchor section.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "insert-section",
        pageId: page.id,
        sectionType: type,
        section,
        position,
      },
    ],
  };
};

// ---- 6. Delete / duplicate / hide / show section ---------------------------

const SECTION_TARGET_RE = /(delete|remove|duplicate|hide|show)\s+(?:the|this)?\s*(first|second|third|fourth|fifth|last)?\s*([\w\-\s]+?)(?:\s+section)?(?:\s+on\s+(?:the|this)?\s*([\w\-\s]+?))?$/i;

function parseSectionTarget(
  instruction: string,
  _b: PlanBuilder,
): { verb: string; ordinal?: string; keyword: string; pageFilter?: string } | null {
  const match = instruction.match(SECTION_TARGET_RE);
  if (!match) return null;
  return {
    verb: match[1].toLowerCase(),
    ordinal: match[2]?.toLowerCase(),
    keyword: match[3].trim(),
    pageFilter: match[4]?.trim(),
  };
}

function applyPageFilter(
  matches: Array<{ page: Page; index: number; section: BaseSection }>,
  filter: string | undefined,
  project: Project,
): Array<{ page: Page; index: number; section: BaseSection }> {
  if (!filter) return matches;
  const pages = resolvePagesByKeyword(project.pages, filter);
  if (pages.length === 0) return [];
  const pageIds = new Set(pages.map((p) => p.id));
  return matches.filter((m) => pageIds.has(m.page.id));
}

const deleteSectionRecognizer: Recognizer = (input, b) => {
  const target = parseSectionTarget(input.instruction, b);
  if (!target || (target.verb !== "delete" && target.verb !== "remove")) {
    return { operations: [] };
  }
  let matches = b.resolveSections(target.keyword, target.ordinal);
  matches = applyPageFilter(matches, target.pageFilter, input.project);
  if (matches.length === 0) {
    b.warn("SECTION_NOT_FOUND", `Could not find a "${target.keyword}" section to delete.`);
    return { operations: [] };
  }
  if (matches.length > 1) {
    b.warn(
      "AMBIGUOUS_DELETE",
      `Multiple "${target.keyword}" sections exist — deletion was skipped. Be more specific (e.g. "the second ${target.keyword} section").`,
    );
    return { operations: [] };
  }
  const { page, section } = matches[0];
  if (page.sections.length <= 1) {
    b.warn("LAST_SECTION", "A page must keep at least one section — the last section cannot be deleted.");
    return { operations: [] };
  }
  const base = opBase(b, "delete-section", "high", `Delete ${section.type} section`, `Permanently removes the "${section.type}" section from the page.`);
  return {
    operations: [
      { ...base, type: "delete-section", pageId: page.id, sectionId: section.id },
    ],
  };
};

const duplicateSectionRecognizer: Recognizer = (input, b) => {
  const target = parseSectionTarget(input.instruction, b);
  if (!target || target.verb !== "duplicate" || !target.keyword) return { operations: [] };
  let matches = b.resolveSections(target.keyword, target.ordinal);
  matches = applyPageFilter(matches, target.pageFilter, input.project);
  if (matches.length === 0) {
    b.warn("SECTION_NOT_FOUND", `Could not find a "${target.keyword}" section to duplicate.`);
    return { operations: [] };
  }
  if (matches.length > 1) {
    b.warn("AMBIGUOUS_DUPLICATE", `Multiple "${target.keyword}" sections exist — duplication was skipped.`);
    return { operations: [] };
  }
  const { page, section } = matches[0];
  if (section.type === "header" || section.type === "footer") {
    b.warn("SINGLETON_DUPLICATE", `${section.type} sections cannot be duplicated.`);
    return { operations: [] };
  }
  const newSectionId = b.idFactory.sectionId(section.type);
  const base = opBase(b, "duplicate-section", "medium", `Duplicate ${section.type} section`, `Creates a copy of the "${section.type}" section right below the original.`);
  return {
    operations: [
      { ...base, type: "duplicate-section", pageId: page.id, sectionId: section.id, newSectionId },
    ],
  };
};

const hideShowSectionRecognizer: Recognizer = (input, b) => {
  const target = parseSectionTarget(input.instruction, b);
  if (!target || (target.verb !== "hide" && target.verb !== "show") || !target.keyword) {
    return { operations: [] };
  }
  const hide = target.verb === "hide";
  let matches = b.resolveSections(target.keyword, target.ordinal);
  matches = applyPageFilter(matches, target.pageFilter, input.project);
  if (matches.length === 0) {
    b.warn("SECTION_NOT_FOUND", `Could not find a "${target.keyword}" section to ${hide ? "hide" : "show"}.`);
    return { operations: [] };
  }
  if (matches.length > 1) {
    b.warn("AMBIGUOUS_VISIBILITY", `Multiple "${target.keyword}" sections exist — nothing was changed.`);
    return { operations: [] };
  }
  const { page, section } = matches[0];
  const visible = !hide;
  if (section.visible === visible) {
    b.warn("NO_OP", `The "${target.keyword}" section is already ${visible ? "visible" : "hidden"}.`);
    return { operations: [] };
  }
  const base = opBase(
    b,
    "set-section-visibility",
    "low",
    `${hide ? "Hide" : "Show"} ${section.type} section`,
    `${hide ? "Hides" : "Shows"} the "${section.type}" section. Hidden sections stay in the page but are not rendered or exported.`,
  );
  return {
    operations: [
      { ...base, type: "set-section-visibility", pageId: page.id, sectionId: section.id, visible },
    ],
  };
};

// ---- 7. Move section ---------------------------------------------------------

const MOVE_SECTION_RE = /move\s+(?:the|this)?\s*(first|second|third|fourth|fifth)?\s*([\w\-\s]+?)(?:\s+section)?\s+(above|below|before|after)\s+(?:the|this)?\s*([\w\-\s]+?)(?:\s+section)?$/i;

const moveSectionRecognizer: Recognizer = (input, b) => {
  if (!/move/i.test(input.instruction)) return { operations: [] };
  const match = input.instruction.match(MOVE_SECTION_RE);
  if (!match) return { operations: [] };

  const sourceKeyword = match[2].trim();
  const relation = match[3].toLowerCase();
  const targetKeyword = match[4].trim();

  const sourceMatches = b.resolveSections(sourceKeyword, match[1]?.toLowerCase());
  if (sourceMatches.length === 0) {
    b.warn("SECTION_NOT_FOUND", `Could not find a "${sourceKeyword}" section to move.`);
    return { operations: [] };
  }
  if (sourceMatches.length > 1) {
    b.warn("AMBIGUOUS_MOVE", `Multiple "${sourceKeyword}" sections exist — the move was skipped.`);
    return { operations: [] };
  }

  // The target must live on the same page as the source.
  const sourcePageId = sourceMatches[0].page.id;
  const targetMatches = b
    .resolveSections(targetKeyword)
    .filter((m) => m.page.id === sourcePageId);
  if (targetMatches.length === 0) {
    b.warn("TARGET_NOT_FOUND", `Could not find a "${targetKeyword}" section on the same page to move relative to.`);
    return { operations: [] };
  }
  if (targetMatches.length > 1) {
    b.warn("AMBIGUOUS_TARGET", `Multiple "${targetKeyword}" sections exist — the move was skipped.`);
    return { operations: [] };
  }

  const sourceIndex = sourceMatches[0].index;
  const targetIndex = targetMatches[0].index;
  if (sourceIndex === targetIndex) {
    b.warn("NO_OP", "The section is already in the requested position.");
    return { operations: [] };
  }

  // "above"/"before" → the source takes the target's slot; "below"/"after"
  // → the source sits right after the target. When moving down past the
  // target, the target's own index shifts by one after removal.
  const isBelow = relation === "below" || relation === "after";
  const movesDown = sourceIndex < targetIndex;
  const targetIndexForOp = isBelow ? (movesDown ? targetIndex : targetIndex + 1) : targetIndex;

  const section = sourceMatches[0].section;
  const base = opBase(
    b,
    "move-section",
    "low",
    `Move ${section.type} ${relation} ${targetKeyword}`,
    `Moves the "${section.type}" section ${relation} the "${targetKeyword}" section.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "move-section",
        pageId: sourcePageId,
        sectionId: section.id,
        targetIndex: Math.max(0, targetIndexForOp),
      },
    ],
  };
};

// ---- 8. Tone rewrite ---------------------------------------------------------

const TONE_KEYWORDS: Array<[ToneKey, string[]]> = [
  ["playful", ["playful", "fun", "quirky", "whimsical", "lighthearted", "cheerful", "witty"]],
  ["professional", ["professional", "corporate", "formal", "business", "trustworthy", "reliable"]],
  ["luxury", ["premium", "luxury", "elegant", "high-end", "sophisticated", "exclusive"]],
  ["minimal", ["minimal", "clean", "simple", "understated", "sleek"]],
  ["bold", ["bold", "punchy", "confident", "impactful", "assertive"]],
  ["friendly", ["friendly", "warm", "welcoming", "approachable", "inviting"]],
];

function detectExplicitTone(instruction: string): ToneKey | null {
  const lower = instruction.toLowerCase();
  for (const [tone, keywords] of TONE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return tone;
  }
  return null;
}

function isCopyInstruction(instruction: string): boolean {
  return /(improve|rewrite|refresh|concise|shorter|tone|regenerate|make better|premium|playful|professional|minimal|shorten|tighten|bold|confident|punchy|friendly|warm|welcoming|elegant|high-end|sophisticated|clean|simple|sleek|fresh|delightful|fun)/i.test(
    instruction,
  );
}

/** Resolve the pages a copy rewrite should target. */
function resolveRewritePages(
  input: AiEditPlannerInput,
  b: PlanBuilder,
): Page[] {
  const instruction = input.instruction;
  const { scope } = input;

  // "Improve the Home and About pages"
  const multiPage = instruction.match(/improve\s+(?:the\s+)?([\w\-\s]+?)\s+and\s+([\w\-\s]+?)\s+pages?/i);
  if (multiPage) {
    const pages: Page[] = [];
    for (const keyword of [multiPage[1].trim(), multiPage[2].trim()]) {
      const matched = resolvePagesByKeyword(input.project.pages, keyword);
      if (matched.length > 0) pages.push(matched[0]);
      else b.warn("PAGE_NOT_FOUND", `Could not find a page matching "${keyword}" to improve.`);
    }
    return pages;
  }

  // "this page" / "this website" / "this entire page"
  if (/(this|the current)\s+(entire\s+)?(page|website|site)/i.test(instruction) || /entire\s+page/i.test(instruction)) {
    if (scope.type === "project") return input.project.pages;
    if (scope.type === "section") {
      const page = b.sectionScopePage();
      return page ? [page] : [];
    }
    const page = input.project.pages.find((p) => p.id === scope.pageId);
    return page ? [page] : [];
  }

  // "all visible copy" / "whole website"
  if (/(all\s+visible\s+copy|whole\s+website|entire\s+website|across\s+the\s+(site|website))/i.test(instruction)) {
    return input.project.pages;
  }

  // "the homepage"
  if (/homepage|home\s+page/i.test(instruction)) {
    return input.project.pages.slice(0, 1);
  }

  // "improve/make/refresh the X page"
  const singlePage = instruction.match(/(?:improve|make|refresh|update|rewrite|regenerate|shorten)\s+(?:the\s+)?([\w\-\s]+?)\s+page/i);
  if (singlePage) {
    const matched = resolvePagesByKeyword(input.project.pages, singlePage[1].trim());
    if (matched.length > 0) return [matched[0]];
    b.warn("PAGE_NOT_FOUND", `Could not find a page matching "${singlePage[1].trim()}" to improve.`);
    return [];
  }

  // Fall back to scope.
  if (scope.type === "project") return input.project.pages;
  if (scope.type === "section") {
    const page = b.sectionScopePage();
    return page ? [page] : [];
  }
  const page = input.project.pages.find((p) => p.id === scope.pageId);
  return page ? [page] : [];
}

const MAX_REWRITE_SECTIONS = 10;

const toneRewriteRecognizer: Recognizer = (input, b) => {
  if (!isCopyInstruction(input.instruction)) return { operations: [] };
  const pages = resolveRewritePages(input, b);
  if (pages.length === 0) return { operations: [] };

  const tone = detectExplicitTone(input.instruction) ?? detectTone(input.instruction);
  const scopeIsProject = input.scope.type === "project";
  const operations: AiEditOperation[] = [];
  let modified = 0;

  for (const page of pages) {
    for (const section of page.sections) {
      if (!section.visible) continue; // visible sections only (spec §23)
      if (modified >= MAX_REWRITE_SECTIONS) {
        b.warn("REWRITE_CAP", `Copy rewrites are capped at ${MAX_REWRITE_SECTIONS} sections — remaining sections were left unchanged.`);
        break;
      }
      const target: EditTarget = {
        kind: "section",
        sectionId: section.id,
        type: section.type,
        label: `${section.type} section`,
        props: section.props,
        context: b.brandContext(),
      };
      const edited = applyRuleBasedEdit(target, input.instruction);
      const changed = JSON.stringify(edited.props) !== JSON.stringify(section.props);
      if (!changed) continue;

      modified += 1;
      const base = opBase(
        b,
        "update-section-props",
        scopeIsProject ? "high" : "medium",
        `${section.type} copy ${tone === "default" ? "refreshed" : `made ${tone}`}`,
        `Rewrites the visible copy of the "${section.type}" section${scopeIsProject ? " as part of a website-wide change" : ""}. Links, prices, and asset references are preserved.`,
      );
      operations.push({
        ...base,
        type: "update-section-props",
        pageId: page.id,
        sectionId: section.id,
        sectionType: section.type,
        nextProps: edited.props,
      });
    }
  }

  if (operations.length === 0) {
    b.warn("NO_CHANGES", "The current copy already matches the requested tone — no changes were planned.");
  }
  return { operations };
};

// ---------------------------------------------------------------------------
// Element recognizers (Phase P22-H) — deterministic element-scoped fallback
//
// These run ONLY when the scope is element ({ type: "element" }). They target
// the selected element and produce ops through the existing element engine
// semantics. Insert ops supply only a registered renderable type + bounded
// content — canonical defaults come from the registry/factory at simulation
// time (never fabricated subtree JSON).
// ---------------------------------------------------------------------------

const ELEMENT_COLORS: Array<[string, string]> = [
  ["blue", "#2563eb"],
  ["red", "#dc2626"],
  ["green", "#16a34a"],
  ["purple", "#7c5cfc"],
  ["orange", "#ea580c"],
  ["pink", "#db2777"],
];

function parseFontSizePx(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const match = value.trim().match(/^([0-9.]+)px$/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

/** Resolve a natural-language keyword to a REGISTERED RENDERABLE block type. */
function resolveBlockTypeKeyword(keyword: string): string | null {
  const lower = keyword.toLowerCase().trim().replace(/\s+/g, " ");
  if (!lower) return null;
  const defs = blockRegistry.list();
  const byType = defs.find((d) => d.type === lower);
  if (byType) return byType.type;
  const byLabel = defs.find((d) => d.label.toLowerCase() === lower);
  if (byLabel) return byLabel.type;
  for (const d of defs) {
    if ((d.keywords ?? []).some((k) => lower.includes(k) || k.includes(lower))) {
      return d.type;
    }
  }
  const singular = lower.replace(/s$/, "");
  const bySingular = defs.find(
    (d) => d.type === singular || d.label.toLowerCase() === singular,
  );
  return bySingular ? bySingular.type : null;
}

function requireElementTarget(
  input: AiEditPlannerInput,
  b: PlanBuilder,
  action: string,
): ReturnType<PlanBuilder["elementScopeTarget"]> {
  const target = b.elementScopeTarget();
  if (!target) {
    b.warn("ELEMENT_NOT_FOUND", `The selected element is missing, so it cannot be ${action}.`);
  }
  return target;
}

// ---- 1. Element style: bold / larger / smaller / accent / color ------------

const elementStyleRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "restyled");
  if (!target) return { operations: [] };
  const instruction = input.instruction.toLowerCase();
  if (/\bon (mobile|tablet)\b/.test(instruction)) return { operations: [] };

  const style: ElementStyleTokens = {};
  let label = "";
  let explanation = "";

  if (/\bbold\b|\bbolder\b|\bheavier\b/.test(instruction)) {
    style.fontWeight = 700;
    label = "Make element bold";
    explanation = "Sets a bold font weight on the selected element.";
  } else if (/\blarger\b|\bbigger\b|\blarger text\b/.test(instruction)) {
    const current = parseFontSizePx(target.node.style?.fontSize) ?? 24;
    style.fontSize = Math.min(200, current + 8);
    label = "Make element larger";
    explanation = `Increases the element's font size to ${style.fontSize}px.`;
  } else if (/\bsmaller\b|\bsmall\b/.test(instruction)) {
    const current = parseFontSizePx(target.node.style?.fontSize) ?? 16;
    style.fontSize = Math.max(8, current - 4);
    label = "Make element smaller";
    explanation = `Decreases the element's font size to ${style.fontSize}px.`;
  } else if (/\baccent\b|\bhighlight\b/.test(instruction)) {
    style.color = "var(--accent, #7c5cfc)";
    label = "Color the element accent";
    explanation = "Applies the site accent color to the element's text.";
  } else {
    for (const [name, hex] of ELEMENT_COLORS) {
      if (new RegExp(`\\b${name}\\b`).test(instruction)) {
        style.color = hex;
        label = `Make the element ${name}`;
        explanation = `Sets the element's text color to ${hex}.`;
        break;
      }
    }
  }

  if (!label) return { operations: [] };
  const base = opBase(b, "update-element-style", "low", label, explanation);
  return {
    operations: [
      {
        ...base,
        type: "update-element-style",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
        style,
      },
    ],
  };
};

// ---- 2. Element responsive: larger/smaller on mobile/tablet -----------------

const elementResponsiveRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "resized responsively");
  if (!target) return { operations: [] };
  const instruction = input.instruction.toLowerCase();
  const breakpointMatch = instruction.match(/\bon (mobile|tablet)\b/);
  if (!breakpointMatch) return { operations: [] };
  const breakpoint = breakpointMatch[1] as ElementPlanBreakpoint;

  const style: ElementStyleTokens = {};
  let label = "";
  if (/\blarger\b|\bbigger\b/.test(instruction)) {
    const current = parseFontSizePx(target.node.style?.fontSize) ?? 24;
    style.fontSize = Math.min(200, current + 8);
    label = `Make element larger on ${breakpoint}`;
  } else if (/\bsmaller\b|\bsmall\b/.test(instruction)) {
    const current = parseFontSizePx(target.node.style?.fontSize) ?? 16;
    style.fontSize = Math.max(8, current - 4);
    label = `Make element smaller on ${breakpoint}`;
  } else if (/\bhidden\b/.test(instruction)) {
    style.display = "none";
    label = `Hide element on ${breakpoint}`;
  } else {
    return { operations: [] };
  }

  const base = opBase(b, "update-element-responsive", "low", label, `Adds ${breakpoint} viewport overrides for the element.`);
  return {
    operations: [
      {
        ...base,
        type: "update-element-responsive",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
        breakpoint,
        style,
      },
    ],
  };
};

// ---- 3. Element animation: fade/slide/bounce on load or scroll -------------

const elementAnimationRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "animated");
  if (!target) return { operations: [] };
  const instruction = input.instruction.toLowerCase();
  if (!/\bfade\b|\bslide\b|\bbounce\b|\banimate\b/.test(instruction)) {
    return { operations: [] };
  }

  const type: ElementAnimation["type"] = /\bslide\b/.test(instruction)
    ? "slide"
    : /\bbounce\b/.test(instruction)
      ? "bounce"
      : "fade";
  const trigger: ElementAnimation["trigger"] = /\bon scroll\b|\bscroll\b/.test(instruction)
    ? "scroll"
    : "load";
  const animation: ElementAnimation = {
    trigger,
    type,
    durationMs: 600,
    easing: "ease",
  };
  const base = opBase(
    b,
    "update-element-animation",
    "low",
    `Animate element (${type} on ${trigger})`,
    `Adds a ${type} entrance animation that plays ${trigger === "load" ? "when the page loads" : "when the element scrolls into view"}.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "update-element-animation",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
        animation,
      },
    ],
  };
};

// ---- 4. Element interaction: link to a page / hover color -------------------

const elementLinkRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "linked");
  if (!target) return { operations: [] };
  const match = input.instruction.match(
    /(?:link|point|go|navigate)\s+(?:it|this|the element|the \w+)?\s*(?:to|toward|towards)\s+(?:the\s+)?(.+?)\s+page/i,
  );
  if (!match) return { operations: [] };
  const pages = resolvePagesByKeyword(input.project.pages, match[1].trim());
  if (pages.length === 0) {
    b.warn("PAGE_NOT_FOUND", `Could not find a page matching "${match[1].trim()}" to link to.`);
    return { operations: [] };
  }
  if (pages.length > 1) {
    b.warn("AMBIGUOUS_PAGE", `Multiple pages match "${match[1].trim()}" — the link target needs to be unique.`);
    return { operations: [] };
  }
  const interaction: ElementInteraction = {
    click: { kind: "navigate", target: { kind: "page", pageId: pages[0].id } },
  };
  const base = opBase(
    b,
    "update-element-interaction",
    "low",
    `Link element to "${pages[0].title}"`,
    `Makes the element navigate to the "${pages[0].title}" page when clicked.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "update-element-interaction",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
        interaction,
      },
    ],
  };
};

const elementHoverRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "stylized");
  if (!target) return { operations: [] };
  const instruction = input.instruction.toLowerCase();
  if (!/\bon hover\b|\bwhen hovered\b/.test(instruction)) return { operations: [] };
  let backgroundColor: string | undefined;
  if (/\baccent\b/.test(instruction)) {
    backgroundColor = "var(--accent, #7c5cfc)";
  } else {
    for (const [name, hex] of ELEMENT_COLORS) {
      if (new RegExp(`\\b${name}\\b`).test(instruction)) {
        backgroundColor = hex;
        break;
      }
    }
  }
  if (!backgroundColor) return { operations: [] };
  const interaction: ElementInteraction = {
    hover: { backgroundColor, color: "#ffffff" },
  };
  const base = opBase(
    b,
    "update-element-interaction",
    "low",
    "Add hover highlight",
    "Highlights the element when the pointer hovers over it.",
  );
  return {
    operations: [
      {
        ...base,
        type: "update-element-interaction",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
        interaction,
      },
    ],
  };
};

// ---- 5. Insert a registered renderable element ------------------------------

const ADD_ELEMENT_RE =
  /add\s+(?:a|an|another|one|new)?\s*([\w\-\s]+?)\s+(?:element|button|heading|paragraph|image|badge|spacer|divider|icon|container|card|stack|row|column|grid|video)\s*(?:to|in|into)\s*(?:this section|the section|here|it)?\s*$/i;

const elementInsertRecognizer: Recognizer = (input, b) => {
  if (input.scope.type !== "element") return { operations: [] };
  const match = input.instruction.match(ADD_ELEMENT_RE);
  if (!match) return { operations: [] };
  const keyword = match[1].trim();
  const type = resolveBlockTypeKeyword(keyword);
  if (!type) {
    b.warn(
      "UNSUPPORTED_ELEMENT_TYPE",
      `"${keyword}" is not a supported element — element-only families have no renderer or persistence path yet.`,
    );
    return { operations: [] };
  }
  const target = b.elementScopeTarget();
  if (!target) {
    b.warn("ELEMENT_NOT_FOUND", "The selected section no longer exists.");
    return { operations: [] };
  }
  const base = opBase(
    b,
    "insert-element",
    "low",
    `Add ${type} element`,
    `Adds a new "${type}" element to the section with default content.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "insert-element",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementType: type,
      },
    ],
  };
};

// ---- 6. Delete / duplicate / hide / show the selected element --------------

const elementDeleteRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "deleted");
  if (!target) return { operations: [] };
  if (!/(?:delete|remove)\s+(?:the\s+)?(?:selected\s+)?(?:this\s+)?(?:element|it|block)\s*$/i.test(input.instruction)) {
    return { operations: [] };
  }
  const base = opBase(
    b,
    "delete-element",
    "high",
    `Delete ${target.node.type} element`,
    `Permanently removes the "${target.node.type}" element from the section.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "delete-element",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
      },
    ],
  };
};

const elementDuplicateRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "duplicated");
  if (!target) return { operations: [] };
  if (!/duplicate\s+(?:the\s+)?(?:selected\s+)?(?:this\s+)?(?:element|it|block)\s*$/i.test(input.instruction)) {
    return { operations: [] };
  }
  const base = opBase(
    b,
    "duplicate-element",
    "medium",
    `Duplicate ${target.node.type} element`,
    `Creates a copy of the "${target.node.type}" element right below the original.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "duplicate-element",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
      },
    ],
  };
};

const elementVisibilityRecognizer: Recognizer = (input, b) => {
  const target = requireElementTarget(input, b, "hidden or shown");
  if (!target) return { operations: [] };
  const match = input.instruction.match(
    /(hide|show)\s+(?:the\s+)?(?:selected\s+)?(?:this\s+)?(?:element|it|block)\s*$/i,
  );
  if (!match) return { operations: [] };
  const visible = match[1].toLowerCase() !== "hide";
  if (target.node.visible === visible) {
    b.warn("NO_OP", `The element is already ${visible ? "visible" : "hidden"}.`);
    return { operations: [] };
  }
  const base = opBase(
    b,
    "set-element-visibility",
    "low",
    `${visible ? "Show" : "Hide"} ${target.node.type} element`,
    `${visible ? "Shows" : "Hides"} the element. Hidden elements are not rendered or exported.`,
  );
  return {
    operations: [
      {
        ...base,
        type: "set-element-visibility",
        pageId: target.page.id,
        sectionId: target.section.id,
        elementId: target.elementId,
        visible,
      },
    ],
  };
};

// ---- Element recognizer order — structural commands before styling ---------

const ELEMENT_RECOGNIZERS: Recognizer[] = [
  elementInsertRecognizer,
  elementDeleteRecognizer,
  elementDuplicateRecognizer,
  elementVisibilityRecognizer,
  elementLinkRecognizer,
  elementHoverRecognizer,
  elementAnimationRecognizer,
  elementResponsiveRecognizer,
  elementStyleRecognizer,
];

// ---------------------------------------------------------------------------
// Recognizer order — destructive/specific commands run before generic rewrite
// ---------------------------------------------------------------------------

const RECOGNIZERS: Recognizer[] = [
  renamePageRecognizer,
  addPageRecognizer,
  deletePageRecognizer,
  movePageRecognizer,
  addSectionRecognizer,
  deleteSectionRecognizer,
  duplicateSectionRecognizer,
  hideShowSectionRecognizer,
  moveSectionRecognizer,
  toneRewriteRecognizer,
];

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

function buildSummary(instruction: string, operations: AiEditOperation[], scope: AiEditScope): string {
  const count = operations.length;
  const target = scopeLabel(scope);
  return `Planned ${count} change${count === 1 ? "" : "s"} for the ${target}.`;
}

export class RuleBasedPlanner implements AiEditPlanner {
  readonly id = "rule-based";
  private readonly idFactory: PlanIdFactory;

  constructor(options?: { idFactory?: PlanIdFactory }) {
    this.idFactory = options?.idFactory ?? createDefaultPlanIdFactory();
    // The section library is registered client-side via EditorProvider; the
    // planner may run server-side (API route) or in tests, so register the
    // defaults here. Idempotent — duplicate registration is a no-op.
    registerDefaultSectionLibrary();
  }

  async createPlan(input: AiEditPlannerInput): Promise<AiEditPlannerResult> {
    const builder = new PlanBuilder(input, this.idFactory);

    // Phase P22-H — element scope runs ONLY the element recognizers (the
    // section/page recognizers would misinterpret element-scoped instructions
    // such as "make it bold" or "hide this element").
    const recognizers =
      input.scope.type === "element" ? ELEMENT_RECOGNIZERS : RECOGNIZERS;

    for (const recognizer of recognizers) {
      const result = recognizer(input, builder);
      builder.operations.push(...result.operations);
    }

    if (builder.operations.length === 0) {
      const warningMessage =
        builder.warnings.length > 0
          ? builder.warnings[0].message
          : "I couldn't determine a concrete change from that instruction. Try being more specific — e.g. \"add a testimonials section below pricing\" or \"make this page more concise\".";
      return {
        ok: false,
        error: { code: "PLAN_NO_CHANGES", message: warningMessage },
        warnings: builder.warnings.map((w) => w.message),
      };
    }

    const plan: AiEditPlan = {
      version: 1,
      id: builder.idFactory.planId(),
      projectId: input.project.id,
      baseRevision: input.baseRevision,
      scope: input.scope,
      instruction: input.instruction,
      summary: buildSummary(input.instruction, builder.operations, input.scope),
      operations: builder.operations,
      warnings: builder.warnings,
      createdAt: new Date().toISOString(),
      provider: "rule-based",
    };

    return { ok: true, plan, warnings: builder.warnings.map((w) => w.message) };
  }
}

/** Convenience singleton with default ID factory. */
export const ruleBasedPlanner = new RuleBasedPlanner();

// ---------------------------------------------------------------------------
// AI Copilot — context builder (Phase P10, spec §3)
//
// Deterministic, serializable, BOUNDED representation of only the information
// needed for the current request. Built when a message is sent — never on
// every keystroke, never a dump of the whole project.
//
// Privacy guarantees:
//   - only whitelisted plain-text fields are copied
//   - assets (data URLs / blobs), theme internals, auth tokens, provider
//     credentials, deployment records, cloud-sync records, recovery data,
//     and unrelated IndexedDB data are NEVER included
//   - every string is capped; the section list is capped; the final JSON is
//     capped and deterministically reduced when it exceeds the limit
// ---------------------------------------------------------------------------

import type { FieldPathSegment } from "@/features/inline-editing/types";
import type { Project, Viewport } from "@/types/project";
import type { LaunchCheck, LaunchReadinessReport } from "@/features/launch-readiness/types";
import type { CopilotMessage, CopilotScope } from "../types";
import { COPILOT_LIMITS, COPILOT_MEMORY_LIMITS } from "../constants";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

const TEXT_CAP = 160;
const ELEMENT_VALUE_CAP = 240;
const INSTRUCTION_CAP = 500;
const CONVERSATION_TAIL = 4;
const CONVERSATION_ITEM_CAP = 200;
const MAX_SECTIONS = 12;
const MAX_FINDINGS = 5;

// ---------------------------------------------------------------------------
// Output model
// ---------------------------------------------------------------------------

export interface CopilotSectionDigest {
  id: string;
  type: string;
  headline?: string;
}

export interface CopilotElementDigest {
  label: string;
  currentValue?: string;
  /** Phase P22-H — selected element target (custom-block trees). */
  elementId?: string;
  elementType?: string;
  /** Bounded whitelisted props (key → capped string value). */
  props?: Array<{ key: string; value: string }>;
  /** Bounded style tokens (key → capped string value). */
  style?: Array<{ key: string; value: string }>;
  /** Bounded viewport overrides (breakpoint → capped JSON). */
  viewport?: Array<{ breakpoint: string; value: string }>;
  /** Compact animation description (capped JSON). */
  animation?: string;
  /** Compact interaction description (capped JSON). */
  interaction?: string;
  /** Number of sibling elements in the parent container. */
  siblingCount?: number;
  /** Parent element type ("section root" when none). */
  parentType?: string;
}

export interface CopilotPagesDigest {
  id: string;
  title: string;
  slug: string;
}

export interface CopilotReadinessDigest {
  score: number;
  topFindings: Array<{ id: string; title: string; status: LaunchCheck["status"] }>;
}

export interface CopilotContext {
  projectId: string;
  projectName: string;
  siteSettings?: {
    siteName?: string;
    siteDescription?: string;
    seoTitle?: string;
    seoDescription?: string;
  };
  activePage?: {
    id: string;
    title: string;
    slug: string;
    meta?: { title?: string; description?: string };
    sectionCount: number;
    sections: CopilotSectionDigest[];
  };
  section?: {
    id: string;
    type: string;
    headline?: string;
    keyText?: Array<{ key: string; value: string }>;
  };
  element?: CopilotElementDigest;
  readiness?: CopilotReadinessDigest;
  device?: Viewport;
  /** Phase P22-H — bounded page list so route references resolve. */
  pages?: CopilotPagesDigest[];
  /** Phase P22-H — bounded theme digest (palette + heading fonts). */
  theme?: {
    palette?: string[];
    fontFamily?: string;
    headingFont?: string;
  };
  conversationTail: string[];
  instruction: string;
  /** Phase P11 — explicit on-device style notes (bounded, capped). */
  styleNotes?: string[];
}

export interface BuildCopilotContextInput {
  project: Project;
  scope: CopilotScope;
  selectedPageId?: string | null;
  selectedSectionId?: string | null;
  selectedField?: {
    label: string;
    currentValue: string;
    pageId: string;
    sectionId: string;
    fieldPath: FieldPathSegment[];
  } | null;
  readiness?: LaunchReadinessReport | null;
  device?: Viewport;
  /** Phase P22-H — the normalized selected element (pageId/sectionId/elementId). */
  selectedElement?: { pageId: string; sectionId: string; elementId: string } | null;
  messages?: CopilotMessage[];
  instruction: string;
  /** Phase P11 — explicit on-device style notes (bounded, capped). */
  styleNotes?: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function cap(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/** Whitelisted headline-like keys for a section digest. */
const HEADLINE_KEYS = ["headline", "title", "subheadline", "subtitle"] as const;

function headlineFor(section: { type: string; props: Record<string, unknown> }): string | undefined {
  for (const key of HEADLINE_KEYS) {
    const value = section.props[key];
    if (typeof value === "string" && value.trim()) return cap(value, TEXT_CAP);
  }
  return undefined;
}

/** Whitelisted short-text keys worth surfacing as "key text" for a section. */
const KEY_TEXT_KEYS = [
  "headline",
  "subheadline",
  "title",
  "subtitle",
  "ctaText",
  "logoText",
  "text",
] as const;

function keyTextFor(section: { props: Record<string, unknown> }): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const key of KEY_TEXT_KEYS) {
    const value = section.props[key];
    if (typeof value === "string" && value.trim()) {
      result.push({ key, value: cap(value, TEXT_CAP) });
      if (result.length >= 5) break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase P22-H — bounded element digest
// ---------------------------------------------------------------------------

const ELEMENT_DIGEST_MAX_KEYS = 8;
const ELEMENT_DIGEST_VALUE_CAP = 120;
const ELEMENT_DIGEST_METADATA_CAP = 300;

function capEntries(
  record: Record<string, unknown> | undefined,
  maxKeys: number,
  include: string[] = [],
): Array<{ key: string; value: string }> | undefined {
  if (!record) return undefined;
  const keys = include.length > 0 ? include : Object.keys(record);
  const out: Array<{ key: string; value: string }> = [];
  for (const key of keys.slice(0, maxKeys)) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text === undefined) continue;
    out.push({ key, value: cap(text, ELEMENT_DIGEST_VALUE_CAP) });
    if (out.length >= maxKeys) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Compact JSON description for animation/interaction metadata. */
function compactMetadata(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const text = JSON.stringify(value);
    return text.length > ELEMENT_DIGEST_METADATA_CAP
      ? `${text.slice(0, ELEMENT_DIGEST_METADATA_CAP)}…`
      : text;
  } catch {
    return undefined;
  }
}

/**
 * Build a bounded digest of a selected element inside a custom-block tree.
 * Pure + deterministic; never exposes the whole tree.
 */
export function buildElementDigest(
  project: Project,
  scope: { pageId: string; sectionId: string; elementId: string },
): CopilotElementDigest | null {
  const page = project.pages.find((p) => p.id === scope.pageId);
  const section = page?.sections.find((s) => s.id === scope.sectionId);
  if (!page || !section) return null;
  const tree = (section.props as { tree?: unknown })?.tree as
    | { rootIds: string[]; nodes: Record<string, { props?: Record<string, unknown>; style?: Record<string, unknown>; viewport?: Record<string, unknown>; animation?: unknown; interaction?: unknown; type?: string; parentId?: string | null; children?: string[] }> }
    | undefined;
  const node = tree?.nodes?.[scope.elementId];
  if (!node) return null;

  const label = elementLabelFor(node.type);
  const textKeys = ["text", "headline", "title", "subheadline", "label"];
  const currentValue =
    capEntries(node.props, 1, textKeys)?.[0]?.value ?? undefined;

  const digest: CopilotElementDigest = {
    label,
    currentValue,
    elementId: scope.elementId,
    elementType: node.type,
    props: capEntries(node.props, ELEMENT_DIGEST_MAX_KEYS, textKeys),
    style: capEntries(node.style, ELEMENT_DIGEST_MAX_KEYS),
    animation: compactMetadata(node.animation),
    interaction: compactMetadata(node.interaction),
  };

  if (node.viewport) {
    digest.viewport = Object.entries(node.viewport)
      .slice(0, 2)
      .map(([breakpoint, value]) => ({
        breakpoint,
        value: cap(JSON.stringify(value), ELEMENT_DIGEST_VALUE_CAP),
      }));
  }

  const parentId = node.parentId ?? null;
  const parent = parentId ? tree?.nodes?.[parentId] : null;
  if (parent) {
    digest.parentType = elementLabelFor(parent.type ?? "container");
    digest.siblingCount = Array.isArray(parent.children)
      ? (parent as { children?: string[] }).children?.length ?? 0
      : 0;
  } else {
    digest.parentType = "section root";
    digest.siblingCount = tree?.rootIds?.length ?? 0;
  }

  return digest;
}

function elementLabelFor(type: string | undefined): string {
  const map: Record<string, string> = {
    heading: "Heading",
    paragraph: "Text",
    button: "Button",
    image: "Image",
    video: "Video",
    icon: "Icon",
    badge: "Badge",
    container: "Container",
    card: "Card",
  };
  if (type && map[type]) return map[type];
  if (type) return type.charAt(0).toUpperCase() + type.slice(1);
  return "Element";
}

// ---------------------------------------------------------------------------
// Deterministic reduction — applied when the JSON exceeds the size limit
// ---------------------------------------------------------------------------

function reduceContext(ctx: CopilotContext, maxBytes: number): CopilotContext {
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  // 1. Drop readiness beyond the top 3 findings.
  if (ctx.readiness && ctx.readiness.topFindings.length > 3) {
    ctx = { ...ctx, readiness: { ...ctx.readiness, topFindings: ctx.readiness.topFindings.slice(0, 3) } };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  // 2. Drop the section list beyond the top 8.
  if (ctx.activePage && ctx.activePage.sections.length > 8) {
    ctx = {
      ...ctx,
      activePage: { ...ctx.activePage, sections: ctx.activePage.sections.slice(0, 8) },
    };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  // 3. Drop section key-text and the element value.
  if (ctx.section?.keyText) {
    ctx = { ...ctx, section: { ...ctx.section, keyText: undefined } };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  if (ctx.element?.currentValue) {
    ctx = { ...ctx, element: { ...ctx.element, currentValue: undefined } };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  // 3b. Phase P22-H — trim the element digest's richer surfaces first.
  if (ctx.element?.style) {
    ctx = { ...ctx, element: { ...ctx.element, style: undefined } };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;
  if (ctx.element?.props) {
    ctx = { ...ctx, element: { ...ctx.element, props: undefined } };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;
  if (ctx.element?.viewport) {
    ctx = { ...ctx, element: { ...ctx.element, viewport: undefined } };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  // 4. Final fallback — drop the conversation tail.
  if (ctx.conversationTail.length > 0) {
    ctx = { ...ctx, conversationTail: [] };
  }
  if (JSON.stringify(ctx).length <= maxBytes) return ctx;

  // 5. Drop style notes last (smallest, user-authored).
  if (ctx.styleNotes && ctx.styleNotes.length > 0) {
    ctx = { ...ctx, styleNotes: undefined };
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildCopilotContext(input: BuildCopilotContextInput): CopilotContext {
  const { project, scope } = input;
  const pages = project.pages ?? [];

  const context: CopilotContext = {
    projectId: project.id,
    projectName: cap(project.name || "Untitled project", 80),
    conversationTail: (input.messages ?? [])
      .slice(-CONVERSATION_TAIL)
      .map((m) => cap(m.content, CONVERSATION_ITEM_CAP))
      .filter(Boolean),
    instruction: cap(input.instruction || "", INSTRUCTION_CAP),
  };

  // ---- Site settings digest (whitelisted text fields only) ----
  const s = project.siteSettings;
  if (s) {
    const siteSettings: CopilotContext["siteSettings"] = {};
    if (s.siteName) siteSettings.siteName = cap(s.siteName, TEXT_CAP);
    if (s.siteDescription) siteSettings.siteDescription = cap(s.siteDescription, TEXT_CAP);
    if (s.seo?.title) siteSettings.seoTitle = cap(s.seo.title, TEXT_CAP);
    if (s.seo?.description) siteSettings.seoDescription = cap(s.seo.description, TEXT_CAP);
    if (Object.keys(siteSettings).length > 0) context.siteSettings = siteSettings;
  }

  // ---- Device ----
  if (input.device) context.device = input.device;

  // ---- Phase P22-H — bounded page list + theme digest ----
  context.pages = project.pages.slice(0, 10).map((p) => ({
    id: p.id,
    title: cap(p.title || "Untitled", 80),
    slug: cap(p.slug || "/", 80),
  }));
  if (project.theme) {
    const palette = Object.values(project.theme.palette ?? {}).filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    context.theme = {
      ...(palette.length > 0 ? { palette: palette.slice(0, 8) } : {}),
      ...(project.theme.typography?.fontFamily
        ? { fontFamily: cap(project.theme.typography.fontFamily, 120) }
        : {}),
      ...(project.theme.typography?.headingFont
        ? { headingFont: cap(project.theme.typography.headingFont, 120) }
        : {}),
    };
  }

  // ---- Style notes (Phase P11) — bounded, capped, never more than the limit ----
  if (input.styleNotes && input.styleNotes.length > 0) {
    context.styleNotes = input.styleNotes
      .slice(0, COPILOT_MEMORY_LIMITS.maxStyleNotesInContext)
      .map((n) => cap(n, COPILOT_MEMORY_LIMITS.maxStyleNoteLength))
      .filter(Boolean);
    if (context.styleNotes.length === 0) delete context.styleNotes;
  }

  // ---- Readiness digest (top findings only) ----
  if (input.readiness) {
    const topFindings = input.readiness.checks
      .filter((c) => c.status === "warning" || c.status === "fail")
      .slice(0, MAX_FINDINGS)
      .map((c) => ({ id: c.id, title: cap(c.title, TEXT_CAP), status: c.status }));
    context.readiness = { score: input.readiness.score, topFindings };
  }

  // ---- Active page ----
  const pageId = scope.type === "project"
    ? (input.selectedPageId ?? pages[0]?.id)
    : scope.pageId;
  const activePage = pages.find((p) => p.id === pageId) ?? pages[0];
  if (activePage) {
    const sections = activePage.sections.slice(0, MAX_SECTIONS).map((section) => ({
      id: section.id,
      type: section.type,
      headline: headlineFor(section),
    }));
    context.activePage = {
      id: activePage.id,
      title: cap(activePage.title || "Untitled page", 80),
      slug: activePage.slug,
      meta: activePage.meta
        ? {
            title: activePage.meta.title ? cap(activePage.meta.title, TEXT_CAP) : undefined,
            description: activePage.meta.description
              ? cap(activePage.meta.description, TEXT_CAP)
              : undefined,
          }
        : undefined,
      sectionCount: activePage.sections.length,
      sections,
    };
  }

  // ---- Section digest (section + element scopes share the section context) ----
  if (scope.type === "section" || scope.type === "element") {
    const section = pages
      .flatMap((p) => p.sections)
      .find((s) => s.id === scope.sectionId);
    if (section) {
      context.section = {
        id: section.id,
        type: section.type,
        headline: headlineFor(section),
        keyText: keyTextFor(section),
      };
    }
  }

  // ---- Element digest (Phase P22-H) ----
  // A selected element (canvas/inspector) wins over the inline field digest;
  // the field-only path is preserved for text-level flows.
  if (scope.type === "element") {
    const elementId =
      scope.elementId ?? input.selectedElement?.elementId;
    const elementScope =
      scope.elementId
        ? { pageId: scope.pageId, sectionId: scope.sectionId, elementId: scope.elementId }
        : input.selectedElement;
    const digest =
      elementScope && elementId
        ? buildElementDigest(project, elementScope)
        : null;
    if (digest) {
      context.element = digest;
    } else {
      const field = input.selectedField;
      if (field) {
        context.element = {
          label: cap(field.label, 80),
          currentValue: cap(field.currentValue, ELEMENT_VALUE_CAP),
        };
      }
    }
  }

  return reduceContext(context, COPILOT_LIMITS.maxContextBytes);
}

/** Serialized size of the context (used by tests + the perf mark). */
export function contextByteLength(context: CopilotContext): number {
  try {
    return JSON.stringify(context).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

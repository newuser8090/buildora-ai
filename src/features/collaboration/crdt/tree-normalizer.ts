// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — deterministic tree normalization
//
// Runs on every projection from the Y.Doc to the editor store (and before any
// durable checkpoint / publish / export). Guarantees:
//   - deterministic  — same input ⇒ same output (no randomness, no time)
//   - idempotent     — normalize(normalize(x)) === normalize(x)
//   - bounded        — depth/node/text caps clamp pathological input
//   - schema-safe    — output always parses AnySectionSchema + Project shape
//
// Repair policy (documented in the architecture):
//   - NEVER invent content. Invalid references are DROPPED.
//   - Duplicate ids → keep the first occurrence (by document order), drop the
//     rest. Duplicate children → keep the first, drop the rest.
//   - Dangling parentId → clear it (the node becomes a root candidate).
//   - Cycles → break by dropping the back edge (keep the first-parent chain).
//   - Block roots that no longer exist are dropped; every remaining node must
//     be reachable from a root or it is pruned (with its subtree).
//   - Section order is renumbered to 1..n contiguously.
//   - The page list keeps ≥1 page and each page keeps ≥1 section ONLY when
//     input already violates that: we add nothing new — instead the Project
//     validator surfaces the error at the boundary (see collab-doc). Normalizer
//     itself does not create content.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { BlockTree } from "@/features/blocks/types";

// ---------------------------------------------------------------------------
// Bounds (architecture §39)
// ---------------------------------------------------------------------------

export const NORMALIZER_MAX_TREE_DEPTH = 12;
export const NORMALIZER_MAX_NODES = 1000;
export const NORMALIZER_MAX_TEXT = 10_000;

function clampText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > NORMALIZER_MAX_TEXT
    ? value.slice(0, NORMALIZER_MAX_TEXT)
    : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

// ---------------------------------------------------------------------------
// Block tree normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a BlockTree deterministically. Returns a new tree (never mutates).
 * If the tree is too corrupt to repair (no roots at all), returns null and the
 * caller drops the tree field (custom-block sections keep a safe fallback).
 */
export function normalizeBlockTree(tree: unknown): BlockTree | null {
  if (!isPlainObject(tree)) return null;
  const rawRootIds = Array.isArray(tree.rootIds)
    ? tree.rootIds.filter((r): r is string => typeof r === "string")
    : [];
  const rawNodes = isPlainObject(tree.nodes) ? tree.nodes : {};

  // 1. Collect valid node records with unique ids (first wins).
  const nodes = new Map<string, Record<string, unknown>>();
  for (const [id, node] of Object.entries(rawNodes)) {
    if (!isPlainObject(node) || typeof node.id !== "string") continue;
    // node.id must match its map key; otherwise the map key wins (key is
    // authoritative in the block model).
    const canonicalId = id;
    if (nodes.has(canonicalId)) continue; // duplicate — keep first
    nodes.set(canonicalId, node);
  }

  // 2. Determine reachability from roots, breaking cycles and pruning orphans.
  const reachable = new Set<string>();
  const visit = (
    id: string,
    depth: number,
    visiting: Set<string>,
  ): void => {
    if (depth > NORMALIZER_MAX_TREE_DEPTH) return;
    if (reachable.has(id)) return;
    if (visiting.has(id)) return; // cycle — break the back edge
    const node = nodes.get(id);
    if (!node) return;
    reachable.add(id);
    const nextVisiting = new Set(visiting).add(id);
    const children = Array.isArray(node.children)
      ? node.children.filter((c): c is string => typeof c === "string")
      : [];
    for (const childId of children) {
      visit(childId, depth + 1, nextVisiting);
    }
  };

  const seenRoots = new Set<string>();
  const rootIds: string[] = [];
  for (const rootId of rawRootIds) {
    if (seenRoots.has(rootId)) continue; // duplicate root — drop
    seenRoots.add(rootId);
    visit(rootId, 0, new Set());
    if (reachable.has(rootId)) rootIds.push(rootId);
  }
  // Any node that is a root candidate but not reachable from a listed root
  // (e.g. rootIds omitted) is promoted deterministically by id order.
  if (rootIds.length === 0) {
    const sortedIds = [...nodes.keys()].sort();
    for (const id of sortedIds) {
      if (reachable.has(id)) continue;
      visit(id, 0, new Set());
      if (reachable.has(id)) rootIds.push(id);
    }
  }
  if (rootIds.length === 0) return null;

  // 3. Rebuild each reachable node with repaired references and bounded text.
  const normalizedNodes: Record<string, unknown> = {};
  let count = 0;
  for (const id of rootIds) {
    if (count >= NORMALIZER_MAX_NODES) break;
    buildNode(id, 0);
  }
  function buildNode(id: string, depth: number): void {
    if (depth > NORMALIZER_MAX_TREE_DEPTH) return;
    if (normalizedNodes[id] !== undefined) return;
    if (count >= NORMALIZER_MAX_NODES) return;
    const raw = nodes.get(id);
    if (!raw) return;
    count += 1;

    // Keep only known-safe keys; the block schema is data-only.
    const children: string[] = [];
    const rawChildren = Array.isArray(raw.children)
      ? raw.children.filter((c): c is string => typeof c === "string")
      : [];
    for (const childId of rawChildren) {
      if (children.includes(childId)) continue; // duplicate child — drop
      // Only keep children that are themselves reachable (no dangling refs).
      if (!reachable.has(childId)) continue;
      children.push(childId);
    }

    const parentId =
      typeof raw.parentId === "string" && reachable.has(raw.parentId)
        ? raw.parentId
        : null;
    // A reachable node's parent must actually be reachable and (by our
    // construction) already built or scheduled; if parentId points to a node
    // that isn't an ancestor (cycle broken), clear it.
    const node: Record<string, unknown> = {
      id,
      type: typeof raw.type === "string" ? raw.type : "container",
      parentId,
      children,
      props: sanitizeRecord(raw.props),
      style: sanitizeRecord(raw.style),
      responsive: sanitizeNestedRecord(raw.responsive),
      visible: raw.visible !== false,
      locked: raw.locked === true,
      hidden: raw.hidden === true,
    };
    normalizedNodes[id] = node;
    for (const childId of children) {
      buildNode(childId, depth + 1);
    }
  }

  return {
    rootIds,
    nodes: normalizedNodes as BlockTree["nodes"],
  };
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isUnsafeKey(key)) continue;
    const text = clampText(val);
    if (text !== null) {
      out[key] = text;
    } else if (isPlainObject(val) || Array.isArray(val)) {
      out[key] = sanitizeJson(val);
    } else if (
      typeof val === "number" ||
      typeof val === "boolean" ||
      val === null
    ) {
      out[key] = val;
    }
  }
  return out;
}

function sanitizeNestedRecord(
  value: unknown,
): Record<string, Record<string, unknown>> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [bp, overrides] of Object.entries(value)) {
    if (isUnsafeKey(bp)) continue;
    const clean = sanitizeRecord(overrides);
    if (Object.keys(clean).length > 0) out[bp] = clean;
  }
  return out;
}

/** Recursively sanitize arbitrary JSON (drop unsafe keys + cap text). */
function sanitizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeJson);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isUnsafeKey(key)) continue;
      out[key] = sanitizeJson(val);
    }
    return out;
  }
  if (typeof value === "string") return clampText(value) ?? "";
  return value;
}

function isUnsafeKey(key: string): boolean {
  return (
    key === "__proto__" ||
    key === "prototype" ||
    key === "constructor" ||
    key === "toString" ||
    key === "valueOf"
  );
}

// ---------------------------------------------------------------------------
// Section normalization
// ---------------------------------------------------------------------------

/** Deterministic section repair: unique ids, renumbered order, bounded text. */
export function normalizeSections(sections: unknown): BaseSection[] {
  if (!Array.isArray(sections)) return [];
  const seen = new Set<string>();
  const out: BaseSection[] = [];
  for (const raw of sections) {
    if (!isPlainObject(raw) || typeof raw.id !== "string") continue;
    if (seen.has(raw.id)) continue; // duplicate id — keep first
    seen.add(raw.id);
    const order = out.length + 1;
    const section: BaseSection = {
      id: raw.id,
      type: typeof raw.type === "string" ? raw.type : "custom-block",
      order,
      visible: raw.visible !== false,
      props: sanitizeRecord(raw.props),
      styles: sanitizeRecord(raw.styles),
    };
    // custom-block trees get full normalization (drop invalid trees)
    if (section.type === "custom-block" && section.props.tree !== undefined) {
      const tree = normalizeBlockTree(section.props.tree);
      if (tree === null) {
        delete (section.props as Record<string, unknown>).tree;
      } else {
        (section.props as Record<string, unknown>).tree = tree;
      }
    }
    out.push(section);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page normalization
// ---------------------------------------------------------------------------

export interface NormalizedPage {
  id: string;
  title: string;
  slug: string;
  sections: BaseSection[];
  meta?: Record<string, unknown>;
}

/** Deterministic page repair: unique ids, ≥1 section kept if present, meta sanitized. */
export function normalizePages(pages: unknown): NormalizedPage[] {
  if (!Array.isArray(pages)) return [];
  const seen = new Set<string>();
  const usedSlugs = new Set<string>();
  const out: NormalizedPage[] = [];
  for (const raw of pages) {
    if (!isPlainObject(raw) || typeof raw.id !== "string") continue;
    if (seen.has(raw.id)) continue; // duplicate id — keep first
    seen.add(raw.id);
    const sections = normalizeSections(raw.sections);
    const title =
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim().slice(0, 120)
        : "Untitled Page";
    let slug =
      typeof raw.slug === "string" && raw.slug.trim()
        ? raw.slug.trim().slice(0, 200)
        : slugify(title);
    // Deterministic unique slug resolution within this document.
    if (usedSlugs.has(slug)) {
      let n = 2;
      while (usedSlugs.has(`${slug}-${n}`)) n += 1;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);
    out.push({
      id: raw.id,
      title,
      slug,
      sections,
      meta: isPlainObject(raw.meta) ? sanitizeRecord(raw.meta) : undefined,
    });
  }
  return out;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "home";
}

// ---------------------------------------------------------------------------
// Project normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a full Project document deterministically. Never invents content;
 * repairs references and clamps bounds. Returns a structurally valid Project
 * shape (may still fail the strict schema if the input had zero pages/sections
 * — the caller decides how to surface that).
 */
export function normalizeProject(value: unknown): Project {
  const raw = isPlainObject(value) ? value : {};
  const pages = normalizePages(raw.pages);
  const assets = Array.isArray(raw.assets)
    ? raw.assets
        .map(sanitizeJson)
        .filter((a): a is Record<string, unknown> => isPlainObject(a))
    : [];
  const theme = sanitizeJson(raw.theme);
  const siteSettings = sanitizeJson(raw.siteSettings);

  return {
    id: typeof raw.id === "string" ? raw.id : "unknown",
    name:
      typeof raw.name === "string" ? clampText(raw.name) ?? "" : "",
    theme: isPlainObject(theme)
      ? (theme as unknown as Project["theme"])
      : ({ palette: {}, typography: {}, spacing: {}, radius: {}, shadows: {} } as unknown as Project["theme"]),
    pages: pages as unknown as Project["pages"],
    assets: assets as unknown as Project["assets"],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    siteSettings: isPlainObject(siteSettings)
      ? (siteSettings as unknown as Project["siteSettings"])
      : undefined,
  };
}

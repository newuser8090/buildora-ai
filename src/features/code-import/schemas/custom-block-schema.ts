// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — custom-block section schema
//
// The custom-block section is the persistence container for imported Block
// Trees. A section of type "custom-block" stores the BlockTree in its props
// alongside safe metadata — the pasted source code itself is NEVER stored.
//
// This module provides:
//   - size caps (nodes / depth / text / style keys)
//   - dangerous-key rejection (prototype pollution, unsafe CSS values)
//   - structural tree validation (unique ids, consistent references, acyclic,
//     no orphans) that is independent of the Phase O registry
//   - the Zod schema used by the section validation union
//   - deterministic repair/normalization for malformed or legacy payloads
//
// Pure, deterministic, framework-independent (no React, no store).
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { ALL_BLOCK_TYPES } from "@/features/blocks/registry/default-blocks";
import {
  ElementAnimationSchema,
  ElementBindingSchema,
  ElementCustomCodeSchema,
  ElementInteractionSchema,
} from "@/features/elements/schemas/element-schemas";
import type { ImportedCodeLanguage } from "../types";

// ---------------------------------------------------------------------------
// Section type constant
// ---------------------------------------------------------------------------

export const CUSTOM_BLOCK_SECTION_TYPE = "custom-block" as const;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_CUSTOM_BLOCK_NODES = 400;
export const MAX_CUSTOM_BLOCK_DEPTH = 24;
export const MAX_CUSTOM_BLOCK_TEXT_LENGTH = 4000;
export const MAX_CUSTOM_BLOCK_STYLE_KEYS = 64;
export const MAX_CUSTOM_BLOCK_PROPS_KEYS = 64;
export const MAX_CUSTOM_BLOCK_NAME_LENGTH = 80;
export const MAX_CUSTOM_BLOCK_CHILDREN = 32;
export const CONVERTER_VERSION = 1;

// ---------------------------------------------------------------------------
// Dangerous key / value policy (mirrors Phase P1 security posture)
// ---------------------------------------------------------------------------

/** Keys that are always rejected in props/style payloads. */
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Keys that are always rejected inside style records (no executable CSS). */
const DANGEROUS_STYLE_KEYS = new Set([
  "behavior",
  "binding",
  "mozbinding",
  "-moz-binding",
]);

function isSafeCssValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    !lower.includes("javascript:") &&
    !lower.includes("vbscript:") &&
    !lower.includes("expression(") &&
    !lower.includes("behavior:") &&
    !lower.includes("binding:") &&
    !lower.includes("url(javascript:")
  );
}

/**
 * Reject dangerous keys at any depth inside a props/style record.
 * Returns a list of problem messages (empty when safe).
 */
export function findDangerousKeys(payload: unknown, path = ""): string[] {
  const problems: string[] = [];
  if (payload === null || typeof payload !== "object") return problems;

  if (Array.isArray(payload)) {
    payload.forEach((item, index) => {
      problems.push(...findDangerousKeys(item, `${path}[${index}]`));
    });
    return problems;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (DANGEROUS_KEYS.has(key)) {
      problems.push(`Dangerous key "${key}"${path ? ` at ${path}` : ""} is not allowed.`);
      continue;
    }
    if (typeof value === "string") {
      if (!isSafeCssValue(value)) {
        problems.push(`Unsafe value for "${key}"${path ? ` at ${path}` : ""} was rejected.`);
      }
    }
    if (value !== null && typeof value === "object") {
      problems.push(...findDangerousKeys(value, `${path}.${key}`));
    }
  }
  return problems;
}

/** True when a props/style payload passes the dangerous-key policy. */
export function isSafeCustomBlockPayload(payload: unknown): boolean {
  return findDangerousKeys(payload).length === 0;
}

// ---------------------------------------------------------------------------
// Structural tree validation (registry-independent)
// ---------------------------------------------------------------------------

export interface CustomBlockTreeProblem {
  message: string;
}

export interface CustomBlockTreeValidation {
  valid: boolean;
  problems: CustomBlockTreeProblem[];
}

/**
 * Validate the structural invariants of a BlockTree without depending on the
 * Phase O registry: node cap, depth cap, unique ids, known block types,
 * consistent parent/children references, acyclicity, no orphaned nodes.
 * Nesting rules are enforced separately through validateTree at write time.
 */
export function validateCustomBlockTree(tree: unknown): CustomBlockTreeValidation {
  const problems: CustomBlockTreeProblem[] = [];
  if (!tree || typeof tree !== "object") {
    return { valid: false, problems: [{ message: "The block tree is not an object." }] };
  }
  const candidate = tree as Partial<BlockTree>;
  const rootIds = Array.isArray(candidate.rootIds) ? candidate.rootIds : [];
  const nodes =
    candidate.nodes && typeof candidate.nodes === "object" && !Array.isArray(candidate.nodes)
      ? (candidate.nodes as Record<string, unknown>)
      : {};

  const nodeIds = Object.keys(nodes);
  if (nodeIds.length > MAX_CUSTOM_BLOCK_NODES) {
    problems.push({
      message: `A custom block can contain at most ${MAX_CUSTOM_BLOCK_NODES} blocks (found ${nodeIds.length}).`,
    });
  }
  if (nodeIds.length === 0) {
    problems.push({ message: "The block tree contains no blocks." });
  }

  const seen = new Set<string>();
  const push = (message: string) => problems.push({ message });

  const walk = (nodeId: string, depth: number, ancestors: Set<string>): void => {
    if (depth > MAX_CUSTOM_BLOCK_DEPTH) {
      push(`The block tree is nested deeper than ${MAX_CUSTOM_BLOCK_DEPTH} levels.`);
      return;
    }
    const raw = nodes[nodeId];
    if (!raw || typeof raw !== "object") {
      push(`Block "${nodeId}" is referenced but missing.`);
      return;
    }
    const node = raw as Partial<BlockNode>;
    // A node that is its own ancestor is a genuine cycle — report it before
    // the generic "reachable more than once" case so the message is accurate.
    if (ancestors.has(nodeId)) {
      push(`Cycle detected at "${nodeId}".`);
      return;
    }
    if (seen.has(nodeId)) {
      push(`Block "${nodeId}" is reachable more than once.`);
      return;
    }
    seen.add(nodeId);

    if (typeof node.type !== "string" || !ALL_BLOCK_TYPES.includes(node.type as BlockNode["type"])) {
      push(`Block "${nodeId}" has unknown type "${String(node.type)}".`);
    }
    if (node.parentId !== null && typeof node.parentId !== "string") {
      push(`Block "${nodeId}" has an invalid parent reference.`);
    }
    if (!Array.isArray(node.children)) {
      push(`Block "${nodeId}" has an invalid children list.`);
      return;
    }
    if (node.children.length > MAX_CUSTOM_BLOCK_CHILDREN) {
      push(`Block "${nodeId}" has more than ${MAX_CUSTOM_BLOCK_CHILDREN} children.`);
    }
    for (const childId of node.children) {
      const child = nodes[childId] as Partial<BlockNode> | undefined;
      if (!child) {
        push(`Block "${nodeId}" references a missing child "${childId}".`);
        continue;
      }
      if (child.parentId !== nodeId) {
        push(`Child "${childId}" does not point back to its parent "${nodeId}".`);
      }
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(nodeId);
      walk(childId, depth + 1, nextAncestors);
    }
  };

  for (const rootId of rootIds) {
    const root = nodes[rootId] as Partial<BlockNode> | undefined;
    if (!root) {
      push(`Root "${rootId}" is missing from the node map.`);
      continue;
    }
    if (root.parentId !== null) {
      push(`Root "${rootId}" must not have a parent.`);
    }
    walk(rootId, 1, new Set());
  }

  for (const id of nodeIds) {
    if (!seen.has(id)) {
      push(`Block "${id}" is orphaned (not reachable from any root).`);
    }
  }

  return { valid: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const knownBlockType = z
  .string()
  .refine(
    (type) => ALL_BLOCK_TYPES.includes(type as BlockNode["type"]),
    { message: "Unknown block type." },
  );

// NOTE: props/style records are validated with z.custom (raw pass-through)
// instead of z.record. Zod's z.record REBUILDS the object while parsing, and
// assigning an own "__proto__" key onto a plain object during that rebuild
// silently sets the prototype instead of keeping the key — the dangerous-key
// refine would never see it, yet the raw key would survive JSON round-trips.
// z.custom checks the RAW input and never rebuilds, so malicious own keys are
// rejected at the boundary.

const StyleRecordSchema = z.custom<Record<string, unknown>>(
  (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length > MAX_CUSTOM_BLOCK_STYLE_KEYS) return false;
    if (Object.keys(record).some((key) => DANGEROUS_STYLE_KEYS.has(key))) return false;
    if (!isSafeCustomBlockPayload(record)) return false;
    return Object.values(record).every((item) => {
      if (typeof item !== "string") return true;
      return isSafeCssValue(item);
    });
  },
  { message: "Style record exceeds limits or contains unsafe values." },
);

const ResponsiveSchema = z
  .record(z.string(), StyleRecordSchema)
  .refine(
    (record) => Object.keys(record).length <= 5,
    { message: "Too many responsive breakpoints." },
  );

// Phase P22-C — OPTIONAL Canva-first viewport overrides on stored
// custom-block nodes (mirrors the P22-B geometry addition). Additive: old
// stored trees (without viewport) still validate; new trees may carry
// tablet/mobile style overrides for the universal inspector's responsive
// section. Bounded: at most 2 viewport keys, each a capped style record.
const NodeViewportSchema = z
  .object({
    tablet: StyleRecordSchema.optional(),
    mobile: StyleRecordSchema.optional(),
  })
  .strict()
  .refine(
    (record) => Object.keys(record).length <= 2,
    { message: "Too many viewport keys." },
  );

// Phase P22-B — OPTIONAL freeform geometry on stored custom-block nodes.
// Additive: old stored trees (without geometry) still validate; new trees may
// carry x/y/width/height/rotation/zIndex for the canvas manipulation layer.
// Bounded and finite — malformed geometry is rejected at the persistence
// boundary (same posture as every other custom-block field).
const NodeGeometrySchema = z.object({
  mode: z.enum(["flow", "absolute"]).default("flow"),
  x: z.number().finite().min(-10000).max(10000).optional(),
  y: z.number().finite().min(-10000).max(10000).optional(),
  width: z.number().finite().min(0).max(10000).optional(),
  height: z.number().finite().min(0).max(10000).optional(),
  rotation: z.number().finite().min(-3600).max(3600).optional(),
  zIndex: z.number().int().min(-1000).max(1000).optional(),
});

export const CustomBlockNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: knownBlockType,
  parentId: z.string().min(1).max(120).nullable(),
  children: z.array(z.string().min(1).max(120)).max(MAX_CUSTOM_BLOCK_CHILDREN),
  geometry: NodeGeometrySchema.optional(),
  viewport: NodeViewportSchema.optional(),
  // Phase P22-G — OPTIONAL declarative interactions + animations on stored
  // custom-block nodes (the P22-A model re-validated verbatim; no schema is
  // redefined here). Additive: old stored trees (without animation/
  // interaction) still validate; new trees may carry them. Bounded and
  // allow-listed — malformed payloads are rejected at the persistence
  // boundary (same posture as geometry/viewport).
  animation: ElementAnimationSchema.optional(),
  interaction: ElementInteractionSchema.optional(),
  // Phase P22-J — OPTIONAL data binding on stored custom-block nodes (the
  // P22-A model re-validated verbatim). Additive: old stored trees (without
  // binding) still validate; new trees may carry them. Bounded and
  // allow-listed — malformed payloads are rejected at the persistence
  // boundary (same posture as geometry/viewport).
  binding: ElementBindingSchema.optional(),
  // Phase P23-C — OPTIONAL custom code on stored custom-block nodes (the
  // P23-A model re-validated verbatim; INERT DATA until `enabled` is
  // explicitly true — persistence never executes anything). Additive: old
  // stored trees (without customCode) still validate; new trees may carry
  // it. Bounded and allow-listed — malformed payloads are rejected at the
  // persistence boundary (same posture as geometry/viewport/binding).
  customCode: ElementCustomCodeSchema.optional(),
  props: z.custom<Record<string, unknown>>(
    (value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length > MAX_CUSTOM_BLOCK_PROPS_KEYS) return false;
      if (!isSafeCustomBlockPayload(record)) return false;
      return Object.values(record).every(
        (item) =>
          typeof item !== "string" || item.length <= MAX_CUSTOM_BLOCK_TEXT_LENGTH,
      );
    },
    { message: "Props contain unsafe keys, values, or over-long text." },
  ),
  style: StyleRecordSchema,
  responsive: ResponsiveSchema,
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
});

export const CustomBlockTreeSchema = z
  .object({
    rootIds: z.array(z.string().min(1).max(120)),
    nodes: z.record(z.string().min(1).max(120), CustomBlockNodeSchema),
  })
  .refine((tree) => validateCustomBlockTree(tree).valid, {
    message: "The block tree failed structural validation.",
  });

export const CustomBlockSourceMetadataSchema = z.object({
  language: z.enum(["html", "jsx", "tsx", "react", "css", "unknown"]).default("unknown"),
  importedAt: z.string().min(1),
  sourceHash: z.string().min(1).max(64),
  converterVersion: z.number().int().positive().default(CONVERTER_VERSION),
  warningCount: z.number().int().nonnegative().default(0),
});

export type CustomBlockSourceMetadata = z.infer<typeof CustomBlockSourceMetadataSchema>;

export const CustomBlockSectionPropsSchema = z.object({
  name: z.string().max(MAX_CUSTOM_BLOCK_NAME_LENGTH).default("Imported design"),
  tree: CustomBlockTreeSchema,
  sourceMetadata: CustomBlockSourceMetadataSchema.optional(),
});

export type ValidatedCustomBlockTree = z.infer<typeof CustomBlockTreeSchema>;

export type ValidatedCustomBlockSectionProps = z.infer<typeof CustomBlockSectionPropsSchema>;

// ---------------------------------------------------------------------------
// Normalization / repair — malformed or legacy custom blocks
// ---------------------------------------------------------------------------

// Phase P22-B/P22-C/P22-G/P22-J/P23-C — stored custom-block nodes MAY carry
// optional freeform geometry, Canva-first viewport overrides, declarative
// animations and interactions, data bindings, and custom code (additive
// runtime fields beyond the base BlockNode type). The intersection type
// keeps the normalizer honest about what it preserves.
//
// Exported so distribution boundaries (P23-E) can type fixtures and clones
// that intentionally carry schema-level customCode without widening the
// universal BlockNode type.
export type StoredCustomBlockNode = BlockNode & {
  geometry?: z.infer<typeof NodeGeometrySchema>;
  viewport?: z.infer<typeof NodeViewportSchema>;
  animation?: z.infer<typeof ElementAnimationSchema>;
  interaction?: z.infer<typeof ElementInteractionSchema>;
  binding?: z.infer<typeof ElementBindingSchema>;
  customCode?: z.infer<typeof ElementCustomCodeSchema>;
};

/**
 * Repair an unknown tree-like value into a structurally valid BlockTree.
 *
 * Repair policy (deterministic, no mutation of input):
 *   - drops unknown block types and unreachable/orphaned nodes
 *   - truncates children lists and style/props records to the caps
 *   - truncates over-long strings
 *   - re-roots any remaining roots; when nothing remains, returns null
 *   - never executes anything and never fabricates content
 */
export function normalizeCustomBlockTree(input: unknown): BlockTree | null {
  if (!input || typeof input !== "object") return null;
  const raw = JSON.parse(JSON.stringify(input)) as {
    rootIds?: unknown;
    nodes?: unknown;
  };

  const rootIds = Array.isArray(raw.rootIds)
    ? (raw.rootIds as string[]).filter((id) => typeof id === "string")
    : [];
  const rawNodes =
    raw.nodes && typeof raw.nodes === "object" && !Array.isArray(raw.nodes)
      ? (raw.nodes as Record<string, unknown>)
      : {};

  const validTypes = new Set(ALL_BLOCK_TYPES as string[]);
  const nodes: Record<string, StoredCustomBlockNode> = {};
  const reachable = new Set<string>();

  const sanitizeString = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    return value.length > MAX_CUSTOM_BLOCK_TEXT_LENGTH
      ? value.slice(0, MAX_CUSTOM_BLOCK_TEXT_LENGTH)
      : value;
  };

  const sanitizeRecord = (record: unknown, cap: number): Record<string, unknown> => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return {};
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, value] of Object.entries(record)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      if (count >= cap) break;
      out[key] = sanitizeString(value);
      count += 1;
    }
    return out;
  };

  // Build the repaired node map from raw nodes.
  for (const [id, rawNode] of Object.entries(rawNodes)) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const node = rawNode as Record<string, unknown>;
    if (typeof node.type !== "string" || !validTypes.has(node.type)) continue;
    if (id.length === 0 || id.length > 120) continue;

    const children = Array.isArray(node.children)
      ? (node.children as unknown[]).filter((c): c is string => typeof c === "string" && c.length > 0).slice(0, MAX_CUSTOM_BLOCK_CHILDREN)
      : [];

    // Carry OPTIONAL geometry through repair (validated; dropped when invalid).
    const parsedGeometry =
      node.geometry === undefined ? undefined : NodeGeometrySchema.safeParse(node.geometry);

    // Carry OPTIONAL viewport overrides through repair (validated; dropped
    // when malformed — same posture as geometry).
    const parsedViewport =
      node.viewport === undefined ? undefined : NodeViewportSchema.safeParse(node.viewport);

    // Phase P22-G — carry OPTIONAL declarative animation + interaction through
    // repair, validated by the SHARED P22-A schemas (never redefined here);
    // malformed payloads are dropped — the allow-list is the only vocabulary
    // the document accepts.
    const parsedAnimation =
      node.animation === undefined ? undefined : ElementAnimationSchema.safeParse(node.animation);

    const parsedInteraction =
      node.interaction === undefined ? undefined : ElementInteractionSchema.safeParse(node.interaction);

    // Phase P22-J — carry OPTIONAL data binding through repair, validated by
    // the SHARED P22-A schema; malformed payloads are dropped (same posture as
    // animation/interaction).
    const parsedBinding =
      node.binding === undefined ? undefined : ElementBindingSchema.safeParse(node.binding);

    // Phase P23-C — carry OPTIONAL custom code through repair, validated by
    // the SHARED P23-A schema (per-field 20k + aggregate 48k caps enforced at
    // parse); malformed payloads are DROPPED — inert data never weakens the
    // boundary. Legacy payloads without `enabled` parse with enabled=false,
    // so they stay inert on reload (never emitted anywhere).
    const parsedCustomCode =
      node.customCode === undefined ? undefined : ElementCustomCodeSchema.safeParse(node.customCode);

    nodes[id] = {
      id,
      type: node.type as BlockNode["type"],
      parentId: typeof node.parentId === "string" && node.parentId.length > 0 ? node.parentId : null,
      children,
      geometry: parsedGeometry && parsedGeometry.success ? parsedGeometry.data : undefined,
      viewport: parsedViewport && parsedViewport.success ? parsedViewport.data : undefined,
      animation: parsedAnimation && parsedAnimation.success ? parsedAnimation.data : undefined,
      interaction: parsedInteraction && parsedInteraction.success ? parsedInteraction.data : undefined,
      binding: parsedBinding && parsedBinding.success ? parsedBinding.data : undefined,
      customCode: parsedCustomCode && parsedCustomCode.success ? parsedCustomCode.data : undefined,
      props: sanitizeRecord(node.props, MAX_CUSTOM_BLOCK_PROPS_KEYS),
      style: sanitizeRecord(node.style, MAX_CUSTOM_BLOCK_STYLE_KEYS),
      responsive: {},
      visible: node.visible !== false,
      locked: node.locked === true,
      hidden: node.hidden === true,
    };
  }

  // Track reachability and prune orphans.
  const markReachable = (id: string, depth: number): void => {
    if (depth > MAX_CUSTOM_BLOCK_DEPTH || reachable.has(id)) return;
    const node = nodes[id];
    if (!node) return;
    reachable.add(id);
    for (const childId of node.children) {
      if (nodes[childId]) markReachable(childId, depth + 1);
    }
  };
  const finalRoots: string[] = [];
  for (const rootId of rootIds) {
    if (!nodes[rootId]) continue;
    finalRoots.push(rootId);
    markReachable(rootId, 1);
  }
  // Keep only reachable nodes.
  for (const id of Object.keys(nodes)) {
    if (!reachable.has(id)) delete nodes[id];
  }

  if (finalRoots.length === 0 || Object.keys(nodes).length === 0) return null;

  return { rootIds: finalRoots, nodes };
}

/**
 * Normalize an unknown custom-block section props value into a valid props
 * object (or null when no usable tree survives). Used by migration paths —
 * never throws.
 */
export function normalizeCustomBlockSectionProps(input: unknown): ValidatedCustomBlockSectionProps | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const tree = normalizeCustomBlockTree(raw.tree);
  if (!tree) return null;

  const name =
    typeof raw.name === "string" && raw.name.trim().length > 0
      ? raw.name.trim().slice(0, MAX_CUSTOM_BLOCK_NAME_LENGTH)
      : "Imported design";

  const metadata = raw.sourceMetadata;
  const parsedMetadata = CustomBlockSourceMetadataSchema.safeParse(metadata);
  const sourceMetadata = parsedMetadata.success ? parsedMetadata.data : undefined;

  const candidate = { name, tree, ...(sourceMetadata ? { sourceMetadata } : {}) };
  const validation = CustomBlockSectionPropsSchema.safeParse(candidate);
  if (!validation.success) return null;
  return validation.data;
}

/** Build a validated source-metadata object from a P2 conversion report. */
export function buildSourceMetadata(input: {
  language: ImportedCodeLanguage;
  sourceHash: string;
  warningCount: number;
  importedAt?: string;
  converterVersion?: number;
}): CustomBlockSourceMetadata {
  return {
    language: input.language,
    importedAt: input.importedAt ?? new Date().toISOString(),
    sourceHash: input.sourceHash,
    converterVersion: input.converterVersion ?? CONVERTER_VERSION,
    warningCount: input.warningCount,
  };
}

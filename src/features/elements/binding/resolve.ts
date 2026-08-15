// ---------------------------------------------------------------------------
// Binding resolver (Phase P22-J) — pure shared resolution of element bindings
//
// Patterned after the asset resolver (src/features/assets/services/asset-
// resolver.ts): pure, deterministic, never throws, safe fallback, no React /
// DOM dependency, no eval, no Function constructor, no arbitrary code
// execution. Collection values are always treated as inert data — they can
// never become HTML or executable code.
//
// Supported binding:
//   binding.source === "collection"
//   binding.collectionId  → identifies the collection (durable Project data)
//   binding.path          → bounded path into the runtime record
//   binding.field         → the element prop the value feeds
//
// Path grammar is explicitly allow-listed: identifier segments
// [A-Za-z_$][A-Za-z0-9_$]* and bounded numeric index access [n]. Anything
// else (.., __proto__, prototype, constructor, absolute paths, quotes,
// spaces, unbounded syntax) is rejected as an unresolved result — never a
// throw. Depth is bounded (4 segments).
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type {
  Collection,
  CollectionFieldType,
  CollectionRecords,
} from "@/features/elements/collections/types";
import type { ElementBinding } from "./types";
import type { ElementNode, ElementTree } from "../types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface BindingResolveContext {
  /** Durable collection definitions from the Project document. */
  collections?: Collection[];
  /** Runtime records keyed by collectionId (integration/provider layer). */
  records?: CollectionRecords;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type BindingUnresolvedReason =
  | "unsupported-source"
  | "missing-collection"
  | "missing-record"
  | "invalid-path"
  | "unsafe-path"
  | "missing-path"
  | "unsafe-value";

export type BindingResolution =
  | { status: "resolved"; value: unknown; fieldType?: CollectionFieldType }
  | { status: "unresolved"; reason: BindingUnresolvedReason };

// ---------------------------------------------------------------------------
// Path grammar (bounded + allow-listed)
// ---------------------------------------------------------------------------

const MAX_PATH_DEPTH = 4;
const MAX_PATH_LENGTH = 512;
const MAX_RESOLVED_VALUE_CHARS = 50_000;

/** Keys rejected at any depth (mirrors tree-normalizer / element schemas). */
const UNSAFE_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);

/** A single path token: identifier with optional bounded index groups. */
const TOKEN_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[[0-9]+\])*$/;

interface PathSegment {
  /** Identifier key, or a numeric array index (as string) when isIndex. */
  key: string;
  isIndex: boolean;
}

type ParseResult =
  | { ok: true; segments: PathSegment[] }
  | { ok: false; reason: "invalid-path" | "unsafe-path" };

/**
 * Parse a bounded data path into segments. Returns a structured failure for
 * ANY unsafe or unsupported syntax (never throws). Index access is only
 * valid as a numeric array subscript directly after an identifier.
 */
function parseBindingPath(path: string): ParseResult {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, reason: "invalid-path" };
  }
  if (path.length > MAX_PATH_LENGTH) return { ok: false, reason: "invalid-path" };
  if (path.includes("..")) return { ok: false, reason: "invalid-path" };
  if (path.includes("//")) return { ok: false, reason: "invalid-path" };
  if (path.startsWith(".") || path.endsWith(".")) return { ok: false, reason: "invalid-path" };
  if (path.includes(" ")) return { ok: false, reason: "invalid-path" };
  if (path.includes('"') || path.includes("'")) return { ok: false, reason: "invalid-path" };

  const rawTokens = path.split(".");
  if (rawTokens.length > MAX_PATH_DEPTH) return { ok: false, reason: "invalid-path" };

  const segments: PathSegment[] = [];
  for (const token of rawTokens) {
    if (token.length === 0) return { ok: false, reason: "invalid-path" };
    if (!TOKEN_RE.test(token)) return { ok: false, reason: "invalid-path" };

    // Split the identifier from its index groups ("images[0][1]" → ident +
    // indexes). The identifier must come first; unsafe keys are rejected
    // explicitly so prototype-pollution paths surface as "unsafe-path".
    const identMatch = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(token);
    if (!identMatch) return { ok: false, reason: "invalid-path" };
    const ident = identMatch[1];
    if (UNSAFE_KEYS.has(ident)) return { ok: false, reason: "unsafe-path" };
    segments.push({ key: ident, isIndex: false });

    const rest = token.slice(ident.length);
    const indexRe = /\[([0-9]+)\]/g;
    let m: RegExpExecArray | null;
    let cursor = 0;
    while ((m = indexRe.exec(rest)) !== null) {
      if (m.index !== cursor) return { ok: false, reason: "invalid-path" };
      segments.push({ key: m[1], isIndex: true });
      cursor = indexRe.lastIndex;
    }
    if (cursor !== rest.length) return { ok: false, reason: "invalid-path" };
  }
  if (segments.length === 0 || segments.length > MAX_PATH_DEPTH) {
    return { ok: false, reason: "invalid-path" };
  }
  return { ok: true, segments };
}

// ---------------------------------------------------------------------------
// Value reading (bounded, no arbitrary property access)
// ---------------------------------------------------------------------------

/** True when the value is inert JSON-safe data (no functions/symbols). */
function isJsonSafeValue(value: unknown): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    if (type === "number" && !Number.isFinite(value as number)) return false;
    if (type === "string" && (value as string).length > MAX_RESOLVED_VALUE_CHARS) {
      return false;
    }
    return true;
  }
  if (type === "object") {
    // Guard against oversized payloads and circular references deterministically.
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) return false;
      if (serialized.length > 50_000) return false;
    } catch {
      return false;
    }
    return true;
  }
  return false;
}

function readPath(
  record: Record<string, unknown>,
  segments: PathSegment[],
): { found: boolean; value: unknown } {
  let current: unknown = record;
  for (const segment of segments) {
    if (segment.isIndex) {
      if (!Array.isArray(current)) return { found: false, value: undefined };
      const index = Number(segment.key);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      return { found: false, value: undefined };
    }
    if (UNSAFE_KEYS.has(segment.key)) return { found: false, value: undefined };
    const obj = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, segment.key)) {
      return { found: false, value: undefined };
    }
    current = obj[segment.key];
  }
  return { found: true, value: current };
}

// ---------------------------------------------------------------------------
// URL safety (mirrors the BlockRenderer / export policy, self-contained so
// the pure resolver never imports a "use client" module)
// ---------------------------------------------------------------------------

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "#"]);

function isSafeUrlString(value: unknown, protocols: Set<string>): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  try {
    const url = new URL(trimmed, "https://buildora.local");
    return protocols.has(url.protocol);
  } catch {
    return false;
  }
}

/** Image src values must be http(s) or relative — never javascript: etc. */
export function isSafeBindingImageValue(value: unknown): boolean {
  return isSafeUrlString(value, new Set(["http:", "https:"]));
}

/** Link href values must pass the safe-link policy (http/https/mailto/tel). */
export function isSafeBindingUrlValue(value: unknown): boolean {
  return isSafeUrlString(value, SAFE_LINK_PROTOCOLS);
}

// ---------------------------------------------------------------------------
// Type coercion (string / number / boolean only)
// ---------------------------------------------------------------------------

function coerceForType(
  value: unknown,
  fieldType: CollectionFieldType | undefined,
): { ok: boolean; value?: unknown } {
  switch (fieldType) {
    case "number": {
      if (typeof value === "number") {
        return Number.isFinite(value) ? { ok: true, value } : { ok: false };
      }
      if (typeof value === "string") {
        const n = Number(value.trim());
        return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
      }
      if (typeof value === "boolean") return { ok: true, value: value ? 1 : 0 };
      return { ok: false };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      if (typeof value === "number") return { ok: true, value: value !== 0 };
      if (typeof value === "string") {
        const t = value.trim().toLowerCase();
        if (t === "true" || t === "1") return { ok: true, value: true };
        if (t === "false" || t === "0") return { ok: true, value: false };
      }
      return { ok: false };
    }
    case "text": {
      if (typeof value === "string") return { ok: true, value };
      if (typeof value === "number" || typeof value === "boolean") {
        return { ok: true, value: String(value) };
      }
      return { ok: false };
    }
    case "image": {
      if (typeof value !== "string") return { ok: false };
      return isSafeBindingImageValue(value) ? { ok: true, value } : { ok: false };
    }
    case "url": {
      if (typeof value !== "string") return { ok: false };
      return isSafeBindingUrlValue(value) ? { ok: true, value } : { ok: false };
    }
    default:
      // No declared field type — keep the raw inert value.
      return { ok: true, value };
  }
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolve an element binding against the durable collections + runtime
 * records. Never throws; every failure is a structured unresolved result.
 */
export function resolveBinding(
  binding: ElementBinding | null | undefined,
  context: BindingResolveContext,
): BindingResolution {
  if (!binding || typeof binding !== "object") {
    return { status: "unresolved", reason: "unsupported-source" };
  }
  // P22-J scope: only the collection source is resolved here. page/project/
  // form/auth remain future capabilities (form writes are explicitly out of
  // scope) — they resolve as unsupported, never as dead unsafe behavior.
  if (binding.source !== "collection") {
    return { status: "unresolved", reason: "unsupported-source" };
  }

  const collections = Array.isArray(context.collections)
    ? context.collections
    : [];
  const collection = binding.collectionId
    ? collections.find((c) => c.id === binding.collectionId)
    : undefined;
  if (!collection) return { status: "unresolved", reason: "missing-collection" };

  const records = context.records?.[collection.id];
  if (!Array.isArray(records) || records.length === 0) {
    return { status: "unresolved", reason: "missing-record" };
  }
  const record = records[0];
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { status: "unresolved", reason: "missing-record" };
  }

  const parsed = parseBindingPath(binding.path ?? "");
  if (!parsed.ok) return { status: "unresolved", reason: parsed.reason };
  const segments = parsed.segments;

  const { found, value } = readPath(record, segments);
  if (!found) return { status: "unresolved", reason: "missing-path" };
  if (!isJsonSafeValue(value)) return { status: "unresolved", reason: "unsafe-value" };

  // Coerce against the collection field whose NAME matches the bound element
  // field (falling back to the path leaf). This is what gives typed values
  // (price → number) and enforces image/url safety from the collection schema.
  const pathLeaf = segments[segments.length - 1];
  const fieldName =
    typeof binding.field === "string" && binding.field.length > 0
      ? binding.field
      : pathLeaf.key;
  const fieldDef = collection.fields.find((f) => f.name === fieldName);
  const fieldType = fieldDef?.type;

  const coerced = coerceForType(value, fieldType);
  if (!coerced.ok || coerced.value === undefined) {
    return { status: "unresolved", reason: "unsafe-value" };
  }
  return { status: "resolved", value: coerced.value, fieldType };
}

// ---------------------------------------------------------------------------
// Prop-level helpers (render + export share these)
// ---------------------------------------------------------------------------

/** Heuristic prop safety for defense-in-depth when no collection field type
 *  declared the value's kind (src → image policy, href → link policy). */
export function safeValueForProp(value: unknown, propKey: string | undefined): unknown {
  if (propKey === "src") {
    return isSafeBindingImageValue(value) ? value : undefined;
  }
  if (propKey === "href") {
    return isSafeBindingUrlValue(value) ? value : undefined;
  }
  return value;
}

/**
 * Resolve one node's bindings into a props override map. Unresolved bindings
 * leave the existing static prop untouched (safe fallback — the node renders
 * exactly as an unbound element).
 */
export function resolveNodeBindingProps(
  node: { binding?: ElementBinding | null; props?: Record<string, unknown> },
  context: BindingResolveContext,
): Record<string, unknown> {
  const binding = node.binding;
  const base = node.props ?? {};
  if (!binding || !binding.field) return base;
  const resolution = resolveBinding(binding, context);
  if (resolution.status !== "resolved") return base;
  const safe = safeValueForProp(resolution.value, binding.field);
  if (safe === undefined) return base;
  return { ...base, [binding.field]: safe };
}

/**
 * Bake all collection bindings in a tree into a static snapshot: every node's
 * resolved values are written into props and the binding metadata is removed.
 * Unresolved bindings are dropped (the static prop fallback remains). The
 * result is plain inert data — no runtime fetching, no dynamic code.
 */
export function bakeTreeBindings(
  tree: ElementTree,
  context: BindingResolveContext,
): ElementTree {
  const nodes: Record<string, ElementNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    let next: ElementNode = node;
    if (node.binding) {
      const { binding: _binding, ...rest } = node;
      void _binding;
      next = {
        ...rest,
        props: resolveNodeBindingProps(node, context),
      };
    }
    nodes[id] = next;
  }
  return { rootIds: [...tree.rootIds], nodes };
}

/**
 * Resolve every collection binding in a project's custom-block trees into a
 * static snapshot. Returns a NEW project (never mutates). Unresolved bindings
 * keep their static fallback values.
 */
export function resolveProjectBindingsForExport(
  project: Project,
  records?: CollectionRecords,
): Project {
  const cloned = JSON.parse(JSON.stringify(project)) as Project;
  const context: BindingResolveContext = {
    collections: cloned.collections,
    records,
  };
  for (const page of cloned.pages) {
    for (const section of page.sections) {
      if (section.type !== "custom-block") continue;
      const tree = (section.props as { tree?: unknown })?.tree;
      if (!tree || typeof tree !== "object") continue;
      (section.props as Record<string, unknown>).tree = bakeTreeBindings(
        tree as ElementTree,
        context,
      );
    }
  }
  return cloned;
}

// ---------------------------------------------------------------------------
// Element operations (Phase P22-A) — pure, immutable tree mutations
//
// The element counterpart of block-operations.ts. Every operation returns a
// NEW tree or a structured error; nothing is ever mutated. History/undo/redo
// belongs to the existing editor store (withHistory/commitLocalProject) — the
// structural algorithms mirror block-operations so the two engines behave
// identically, and every result is validated against the element registry +
// field schemas before it can escape.
//
// Element metadata ops (geometry, viewport, animation, interaction, binding,
// accessibility, custom code) are validated against their Zod schemas and
// merged immutably. No UI is implemented here (P22-B+).
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import { elementRegistry } from "../registry/element-registry";
import { canNestElement, firstElementTreeError } from "./element-validation";
import { parentOf } from "@/features/blocks/engine/tree-traversal";
import type { BlockTree } from "@/features/blocks/types";
import {
  getButtonPreset,
  getCardPreset,
  getImagePreset,
} from "@/features/blocks/engine/block-presets";
import {
  ELEMENT_MAX_RESPONSIVE_BREAKPOINTS,
  ElementAccessibilitySchema,
  ElementAnimationSchema,
  ElementBindingSchema,
  ElementCustomCodeSchema,
  ElementGeometrySchema,
  ElementInteractionSchema,
  ElementStyleTokensSchema,
} from "../schemas/element-schemas";
import type {
  ElementAccessibility,
  ElementAnimation,
  ElementBinding,
  ElementCustomCode,
  ElementError,
  ElementErrorCode,
  ElementGeometry,
  ElementInteraction,
  ElementNode,
  ElementResult,
  ElementStyleTokens,
  ElementTree,
  ElementType,
} from "../types";
import type { ElementViewportKey } from "../responsive/types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Deterministic-ish, collision-resistant element id factory. */
export function createElementId(type: ElementType): string {
  idCounter += 1;
  return `${type}-${Date.now().toString(36)}-${idCounter}`;
}

/** Build a fresh element node with registry default props/styles. */
export function createElement(
  type: ElementType,
  options?: {
    id?: string;
    props?: Record<string, unknown>;
    style?: ElementStyleTokens;
  },
): ElementNode {
  const definition = elementRegistry.get(type);
  const props = definition?.createProps() ?? {};
  const style = definition?.createStyles() ?? {};
  return {
    id: options?.id ?? createElementId(type),
    type,
    parentId: null,
    children: [],
    props: { ...props, ...(options?.props ?? {}) },
    style: { ...style, ...(options?.style ?? {}) },
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clone one node including the element metadata fields. */
function cloneNode(node: ElementNode): ElementNode {
  const cloned: ElementNode = {
    ...node,
    props: { ...node.props },
    style: { ...node.style },
    responsive: Object.fromEntries(
      Object.entries(node.responsive).map(([bp, overrides]) => [bp, { ...overrides }]),
    ),
    children: [...node.children],
  };
  if (node.geometry) cloned.geometry = { ...node.geometry };
  if (node.viewport) {
    cloned.viewport = {
      ...(node.viewport.tablet ? { tablet: { ...node.viewport.tablet } } : {}),
      ...(node.viewport.mobile ? { mobile: { ...node.viewport.mobile } } : {}),
    };
  }
  if (node.animation) cloned.animation = { ...node.animation };
  if (node.interaction) cloned.interaction = cloneInteraction(node.interaction);
  if (node.binding) cloned.binding = { ...node.binding };
  if (node.a11y) cloned.a11y = { ...node.a11y };
  if (node.customCode) {
    cloned.customCode = {
      ...(node.customCode.css ? { css: node.customCode.css } : {}),
      ...(node.customCode.js ? { js: node.customCode.js } : {}),
      ...(node.customCode.html ? { html: node.customCode.html } : {}),
      ...(node.customCode.attributes ? { attributes: { ...node.customCode.attributes } } : {}),
    };
  }
  return cloned;
}

function cloneInteraction(interaction: ElementInteraction): ElementInteraction {
  const out: ElementInteraction = {};
  if (interaction.click) {
    const click = interaction.click;
    if (click.kind === "navigate") {
      out.click = { kind: "navigate", target: { ...click.target } };
    } else {
      out.click = { ...click };
    }
  }
  if (interaction.hover) out.hover = { ...interaction.hover };
  if (interaction.focus) out.focus = { ...interaction.focus };
  if (interaction.scroll) out.scroll = { ...interaction.scroll };
  if (interaction.load) out.load = { ...interaction.load };
  return out;
}

function cloneTree(tree: ElementTree): ElementTree {
  const nodes: Record<string, ElementNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = cloneNode(node);
  }
  return { rootIds: [...tree.rootIds], nodes };
}

function validateResult(tree: ElementTree): ElementResult<ElementTree> {
  const error = firstElementTreeError(tree);
  if (error) return { ok: false, error };
  return { ok: true, value: tree };
}

function requireNode(tree: ElementTree, elementId: string): ElementResult<ElementNode> {
  const node = tree.nodes[elementId];
  if (!node) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_NOT_FOUND",
        message: `Element "${elementId}" does not exist in the tree.`,
      },
    };
  }
  return { ok: true, value: node };
}

function lockedError(action: string): ElementError {
  return {
    code: "ELEMENT_LOCKED",
    message: `Locked elements cannot be ${action}.`,
  };
}

/**
 * Merge props and enforce the element type's typed props schema (when the
 * registry definition declares one). Shared by every authoring op so the
 * validation boundary is consistent. Block-derived types use the generic
 * bounded schema (adapter marker keys allowed).
 */
function mergePropsWithValidation(
  type: ElementType,
  baseProps: Record<string, unknown>,
  patch: Record<string, unknown>,
): ElementResult<Record<string, unknown>> {
  const merged = { ...baseProps, ...patch };
  const validation = elementRegistry.get(type)?.validateProps?.(merged);
  if (validation && !validation.ok) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_PROPS_INVALID",
        message: validation.issues[0] ?? "Props failed validation.",
      },
    };
  }
  return { ok: true, value: merged };
}

// ---------------------------------------------------------------------------
// Structural operations (mirror block-operations semantics)
// ---------------------------------------------------------------------------

export function insertElement(
  tree: ElementTree,
  parentId: string,
  element: ElementNode,
  index?: number,
): ElementResult<ElementTree> {
  const parent = tree.nodes[parentId];
  if (!parent) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_TARGET_NOT_FOUND",
        message: `Parent element "${parentId}" does not exist.`,
      },
    };
  }
  if (tree.nodes[element.id]) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_ID_CONFLICT",
        message: `Element id "${element.id}" already exists in the tree.`,
      },
    };
  }
  if (parent.locked) return { ok: false, error: lockedError("modified") };
  if (!canNestElement(parent.type, element.type)) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_NESTING_RULE_VIOLATION",
        message: `A "${element.type}" element cannot be nested inside a "${parent.type}" element.`,
      },
    };
  }

  // Defense-in-depth: the incoming element's props must satisfy the typed
  // props schema for its type (schema-level bounds are enforced by the final
  // validateResult as well).
  const propsCheck = mergePropsWithValidation(element.type, {}, element.props);
  if (!propsCheck.ok) return propsCheck;

  const next = cloneTree(tree);
  const nextParent = next.nodes[parentId];
  const normalizedIndex = index ?? nextParent.children.length;
  next.nodes[element.id] = { ...cloneNode(element), parentId };
  nextParent.children = [
    ...nextParent.children.slice(0, normalizedIndex),
    element.id,
    ...nextParent.children.slice(normalizedIndex),
  ];

  return validateResult(next);
}

export function deleteElement(
  tree: ElementTree,
  elementId: string,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;

  // ElementTree is structurally identical to BlockTree; the traversal helper
  // is shape-agnostic, so the cast is safe.
  const parent = parentOf(tree as unknown as BlockTree, elementId);
  const next = cloneTree(tree);
  delete next.nodes[elementId];

  if (parent) {
    next.nodes[parent.id].children = next.nodes[parent.id].children.filter(
      (c) => c !== elementId,
    );
  } else {
    next.rootIds = next.rootIds.filter((r) => r !== elementId);
  }

  // Prune orphaned descendants so the result stays valid.
  const stack = [...(tree.nodes[elementId]?.children ?? [])];
  while (stack.length > 0) {
    const current = stack.shift() ?? "";
    if (next.nodes[current]) {
      delete next.nodes[current];
      stack.unshift(...(tree.nodes[current]?.children ?? []));
    }
  }

  return validateResult(next);
}

export function duplicateElement(
  tree: ElementTree,
  elementId: string,
): ElementResult<{ tree: ElementTree; newId: string }> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;

  const source = nodeResult.value;
  if (source.locked) return { ok: false, error: lockedError("duplicated") };

  // ElementTree is structurally identical to BlockTree (shape-agnostic helper).
  const parent = parentOf(tree as unknown as BlockTree, elementId);

  // Deep-cloned subtree in isolation with remapped ids.
  const idMap = new Map<string, string>();
  const collectIds = (node: ElementNode): void => {
    idMap.set(node.id, createElementId(node.type));
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) collectIds(child);
    }
  };
  collectIds(source);

  const clonedNodes = new Map<string, ElementNode>();
  const cloneSubtree = (node: ElementNode): ElementNode => {
    const cloned: ElementNode = {
      ...cloneNode(node),
      id: idMap.get(node.id) ?? createElementId(node.type),
      parentId: idMap.get(node.parentId ?? "") ?? node.parentId,
      children: node.children.map((c) => idMap.get(c) ?? createElementId("container")),
    };
    clonedNodes.set(cloned.id, cloned);
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) cloneSubtree(child);
    }
    return cloned;
  };
  const cloned = cloneSubtree(source);

  const next = cloneTree(tree);
  for (const [id, node] of clonedNodes) {
    next.nodes[id] = node;
  }

  if (parent) {
    const index = next.nodes[parent.id].children.indexOf(elementId);
    next.nodes[parent.id].children = [
      ...next.nodes[parent.id].children.slice(0, index + 1),
      cloned.id,
      ...next.nodes[parent.id].children.slice(index + 1),
    ];
  } else {
    const index = next.rootIds.indexOf(elementId);
    next.rootIds = [
      ...next.rootIds.slice(0, index + 1),
      cloned.id,
      ...next.rootIds.slice(index + 1),
    ];
  }

  const result = validateResult(next);
  if (!result.ok) return result;
  return { ok: true, value: { tree: result.value, newId: cloned.id } };
}

export function moveElement(
  tree: ElementTree,
  elementId: string,
  toParentId: string,
  toIndex?: number,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;

  const node = nodeResult.value;
  if (node.locked) return { ok: false, error: lockedError("moved") };
  if (!tree.nodes[toParentId]) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_TARGET_NOT_FOUND",
        message: `Target parent "${toParentId}" does not exist.`,
      },
    };
  }

  // Cannot move a node into its own descendant (would create a cycle).
  const isDescendant = node.children.some((c) => {
    let current: ElementNode | undefined = tree.nodes[c];
    while (current) {
      if (current.id === toParentId) return true;
      current = current.parentId !== null ? tree.nodes[current.parentId] : undefined;
    }
    return false;
  });
  if (isDescendant) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_NESTING_RULE_VIOLATION",
        message: "An element cannot be moved into one of its own children.",
      },
    };
  }

  const targetParent = tree.nodes[toParentId];
  if (targetParent.locked) return { ok: false, error: lockedError("moved into") };
  if (!canNestElement(targetParent.type, node.type)) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_NESTING_RULE_VIOLATION",
        message: `A "${node.type}" element cannot be nested inside a "${targetParent.type}" element.`,
      },
    };
  }

  const next = cloneTree(tree);
  const oldParentId = node.parentId;

  if (oldParentId !== null && next.nodes[oldParentId]) {
    next.nodes[oldParentId].children = next.nodes[oldParentId].children.filter(
      (c) => c !== elementId,
    );
  } else {
    next.rootIds = next.rootIds.filter((r) => r !== elementId);
  }

  next.nodes[elementId] = { ...next.nodes[elementId], parentId: toParentId };
  const index = toIndex ?? next.nodes[toParentId].children.length;
  next.nodes[toParentId].children = [
    ...next.nodes[toParentId].children.slice(0, index),
    elementId,
    ...next.nodes[toParentId].children.slice(index),
  ];

  return validateResult(next);
}

export function setElementLocked(
  tree: ElementTree,
  elementId: string,
  locked: boolean,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  const next = cloneTree(tree);
  next.nodes[elementId] = { ...next.nodes[elementId], locked };
  return validateResult(next);
}

export function setElementHidden(
  tree: ElementTree,
  elementId: string,
  hidden: boolean,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  const next = cloneTree(tree);
  next.nodes[elementId] = { ...next.nodes[elementId], hidden };
  return validateResult(next);
}

export function setElementVisible(
  tree: ElementTree,
  elementId: string,
  visible: boolean,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  const next = cloneTree(tree);
  next.nodes[elementId] = { ...next.nodes[elementId], visible };
  return validateResult(next);
}

export function renameElement(
  tree: ElementTree,
  elementId: string,
  label: string,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  const trimmed = label.trim().slice(0, 80);
  const propsCheck = mergePropsWithValidation(
    nodeResult.value.type,
    nodeResult.value.props,
    { name: trimmed },
  );
  if (!propsCheck.ok) return propsCheck;
  const next = cloneTree(tree);
  next.nodes[elementId] = {
    ...next.nodes[elementId],
    props: propsCheck.value,
  };
  return validateResult(next);
}

export function updateElementProps(
  tree: ElementTree,
  elementId: string,
  props: Record<string, unknown>,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("edited") };

  // Typed per-family props schemas are enforced at the authoring boundary
  // (registry definitions); block-derived types use the generic bounded
  // schema, which permits adapter marker keys.
  const merged = mergePropsWithValidation(nodeResult.value.type, nodeResult.value.props, props);
  if (!merged.ok) return merged;

  const next = cloneTree(tree);
  next.nodes[elementId] = {
    ...next.nodes[elementId],
    props: merged.value,
  };
  return validateResult(next);
}

export function updateElementStyle(
  tree: ElementTree,
  elementId: string,
  style: ElementStyleTokens,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("styled") };
  const next = cloneTree(tree);
  next.nodes[elementId] = {
    ...next.nodes[elementId],
    style: { ...next.nodes[elementId].style, ...style },
  };
  return validateResult(next);
}

// ---------------------------------------------------------------------------
// Metadata operations (element-only)
// ---------------------------------------------------------------------------

function metadataError(code: ElementErrorCode, message: string): ElementResult<never> {
  return { ok: false, error: { code, message } };
}

export function updateElementGeometry(
  tree: ElementTree,
  elementId: string,
  geometry: Partial<ElementGeometry>,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("moved") };

  const merged: ElementGeometry = {
    ...(nodeResult.value.geometry ?? { mode: "flow" as const }),
    ...geometry,
  };
  const parsed = ElementGeometrySchema.safeParse(merged);
  if (!parsed.success) {
    return metadataError(
      "ELEMENT_GEOMETRY_INVALID",
      parsed.error.issues[0]?.message ?? "Invalid geometry.",
    );
  }
  const next = cloneTree(tree);
  next.nodes[elementId] = { ...next.nodes[elementId], geometry: parsed.data };
  return validateResult(next);
}

export function updateElementViewport(
  tree: ElementTree,
  elementId: string,
  viewport: "base" | ElementViewportKey,
  style: ElementStyleTokens,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("styled") };
  if (Object.keys(style).length === 0) return { ok: true, value: tree };

  const next = cloneTree(tree);
  if (viewport === "base") {
    next.nodes[elementId] = {
      ...next.nodes[elementId],
      style: { ...next.nodes[elementId].style, ...style },
    };
    return validateResult(next);
  }

  const currentViewport = next.nodes[elementId].viewport ?? {};
  const currentAtKey = currentViewport[viewport] ?? {};
  const merged: Record<string, unknown> = { ...currentAtKey, ...style };
  const parsedStyle = parseStyleTokens(merged);
  if (!parsedStyle) {
    return metadataError("ELEMENT_VIEWPORT_INVALID", "Invalid viewport style overrides.");
  }
  next.nodes[elementId] = {
    ...next.nodes[elementId],
    viewport: { ...currentViewport, [viewport]: parsedStyle },
  };
  return validateResult(next);
}

export function updateElementResponsive(
  tree: ElementTree,
  elementId: string,
  breakpoint: string,
  style: ElementStyleTokens,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("styled") };
  if (breakpoint.length === 0 || breakpoint.length > 32) {
    return metadataError("ELEMENT_VIEWPORT_INVALID", "Invalid responsive breakpoint name.");
  }
  if (Object.keys(style).length === 0) return { ok: true, value: tree };
  const currentBreakpoints = Object.keys(nodeResult.value.responsive);
  if (
    currentBreakpoints.length >= ELEMENT_MAX_RESPONSIVE_BREAKPOINTS &&
    !currentBreakpoints.includes(breakpoint)
  ) {
    return metadataError(
      "ELEMENT_VIEWPORT_INVALID",
      `An element supports at most ${ELEMENT_MAX_RESPONSIVE_BREAKPOINTS} responsive breakpoints.`,
    );
  }

  const next = cloneTree(tree);
  const currentAtBreakpoint = next.nodes[elementId].responsive[breakpoint] ?? {};
  const merged: Record<string, unknown> = { ...currentAtBreakpoint, ...style };
  const parsedStyle = parseStyleTokens(merged);
  if (!parsedStyle) {
    return metadataError("ELEMENT_VIEWPORT_INVALID", "Invalid responsive style overrides.");
  }
  next.nodes[elementId] = {
    ...next.nodes[elementId],
    responsive: {
      ...next.nodes[elementId].responsive,
      [breakpoint]: parsedStyle,
    },
  };
  return validateResult(next);
}

export function updateElementAnimation(
  tree: ElementTree,
  elementId: string,
  animation: ElementAnimation | null,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("animated") };
  if (animation !== null) {
    const parsed = ElementAnimationSchema.safeParse(animation);
    if (!parsed.success) {
      return metadataError(
        "ELEMENT_ANIMATION_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid animation.",
      );
    }
  }
  const next = cloneTree(tree);
  const updated: ElementNode = { ...next.nodes[elementId] };
  if (animation === null) delete updated.animation;
  else updated.animation = animation;
  next.nodes[elementId] = updated;
  return validateResult(next);
}

export function updateElementInteraction(
  tree: ElementTree,
  elementId: string,
  interaction: ElementInteraction | null,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("modified") };
  if (interaction !== null) {
    const parsed = ElementInteractionSchema.safeParse(interaction);
    if (!parsed.success) {
      return metadataError(
        "ELEMENT_INTERACTION_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid interaction.",
      );
    }
  }
  const next = cloneTree(tree);
  const updated: ElementNode = { ...next.nodes[elementId] };
  if (interaction === null) delete updated.interaction;
  else updated.interaction = interaction;
  next.nodes[elementId] = updated;
  return validateResult(next);
}

export function updateElementBinding(
  tree: ElementTree,
  elementId: string,
  binding: ElementBinding | null,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("modified") };
  if (binding !== null) {
    const parsed = ElementBindingSchema.safeParse(binding);
    if (!parsed.success) {
      return metadataError(
        "ELEMENT_BINDING_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid binding.",
      );
    }
  }
  const next = cloneTree(tree);
  const updated: ElementNode = { ...next.nodes[elementId] };
  if (binding === null) delete updated.binding;
  else updated.binding = binding;
  next.nodes[elementId] = updated;
  return validateResult(next);
}

export function updateElementAccessibility(
  tree: ElementTree,
  elementId: string,
  a11y: ElementAccessibility | null,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (a11y !== null) {
    const parsed = ElementAccessibilitySchema.safeParse(a11y);
    if (!parsed.success) {
      return metadataError(
        "ELEMENT_ACCESSIBILITY_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid accessibility metadata.",
      );
    }
  }
  const next = cloneTree(tree);
  const updated: ElementNode = { ...next.nodes[elementId] };
  if (a11y === null) delete updated.a11y;
  else updated.a11y = a11y;
  next.nodes[elementId] = updated;
  return validateResult(next);
}

export function updateElementCustomCode(
  tree: ElementTree,
  elementId: string,
  code: ElementCustomCode | null,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (code !== null) {
    const parsed = ElementCustomCodeSchema.safeParse(code);
    if (!parsed.success) {
      return metadataError(
        "ELEMENT_CUSTOM_CODE_INVALID",
        parsed.error.issues[0]?.message ?? "Invalid custom code payload.",
      );
    }
  }
  const next = cloneTree(tree);
  const updated: ElementNode = { ...next.nodes[elementId] };
  if (code === null) delete updated.customCode;
  else updated.customCode = code;
  next.nodes[elementId] = updated;
  return validateResult(next);
}

// ---------------------------------------------------------------------------
// Presets (delegate to the existing block preset engine)
// ---------------------------------------------------------------------------

export function applyElementPreset(
  tree: ElementTree,
  elementId: string,
  presetId: string,
): ElementResult<ElementTree> {
  const nodeResult = requireNode(tree, elementId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) return { ok: false, error: lockedError("restyled") };

  // Reuse the block engine's preset DATA (button/card/image). Presets apply
  // style/prop overrides and are valid for any element type.
  const preset =
    getButtonPreset(presetId) ??
    getCardPreset(presetId) ??
    getImagePreset(presetId);
  if (!preset) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_TREE_INVALID",
        message: `Unknown preset "${presetId}".`,
      },
    };
  }
  const next = cloneTree(tree);
  next.nodes[elementId] = {
    ...next.nodes[elementId],
    style: { ...next.nodes[elementId].style, ...preset.applyStyles },
    props: { ...next.nodes[elementId].props, ...(preset.applyProps ?? {}) },
  };
  return validateResult(next);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type ElementOperation =
  | { kind: "insert"; parentId: string; index?: number; element: ElementNode }
  | { kind: "delete"; elementId: string }
  | { kind: "duplicate"; elementId: string }
  | { kind: "move"; elementId: string; toParentId: string; toIndex?: number }
  | { kind: "lock"; elementId: string; locked: boolean }
  | { kind: "hide"; elementId: string; hidden: boolean }
  | { kind: "set-visible"; elementId: string; visible: boolean }
  | { kind: "rename"; elementId: string; label: string }
  | { kind: "update-props"; elementId: string; props: Record<string, unknown> }
  | { kind: "update-style"; elementId: string; style: ElementStyleTokens }
  | {
      kind: "update-geometry";
      elementId: string;
      geometry: Partial<ElementGeometry>;
    }
  | {
      kind: "update-viewport";
      elementId: string;
      viewport: "base" | ElementViewportKey;
      style: ElementStyleTokens;
    }
  | {
      kind: "update-responsive";
      elementId: string;
      breakpoint: string;
      style: ElementStyleTokens;
    }
  | {
      kind: "update-animation";
      elementId: string;
      animation: ElementAnimation | null;
    }
  | {
      kind: "update-interaction";
      elementId: string;
      interaction: ElementInteraction | null;
    }
  | { kind: "update-binding"; elementId: string; binding: ElementBinding | null }
  | { kind: "update-a11y"; elementId: string; a11y: ElementAccessibility | null }
  | {
      kind: "update-custom-code";
      elementId: string;
      code: ElementCustomCode | null;
    }
  | { kind: "apply-preset"; elementId: string; presetId: string };

/**
 * Apply a single ElementOperation immutably. Returns the new tree (validated)
 * or a structured error. History/undo/redo belong to the caller's store —
 * this function never touches persistence or store state.
 */
export function applyElementOperation(
  tree: ElementTree,
  operation: ElementOperation,
): ElementResult<ElementTree | { tree: ElementTree; newId: string }> {
  switch (operation.kind) {
    case "insert":
      return insertElement(tree, operation.parentId, operation.element, operation.index);
    case "delete":
      return deleteElement(tree, operation.elementId);
    case "duplicate":
      return duplicateElement(tree, operation.elementId);
    case "move":
      return moveElement(tree, operation.elementId, operation.toParentId, operation.toIndex);
    case "lock":
      return setElementLocked(tree, operation.elementId, operation.locked);
    case "hide":
      return setElementHidden(tree, operation.elementId, operation.hidden);
    case "set-visible":
      return setElementVisible(tree, operation.elementId, operation.visible);
    case "rename":
      return renameElement(tree, operation.elementId, operation.label);
    case "update-props":
      return updateElementProps(tree, operation.elementId, operation.props);
    case "update-style":
      return updateElementStyle(tree, operation.elementId, operation.style);
    case "update-geometry":
      return updateElementGeometry(tree, operation.elementId, operation.geometry);
    case "update-viewport":
      return updateElementViewport(tree, operation.elementId, operation.viewport, operation.style);
    case "update-responsive":
      return updateElementResponsive(tree, operation.elementId, operation.breakpoint, operation.style);
    case "update-animation":
      return updateElementAnimation(tree, operation.elementId, operation.animation);
    case "update-interaction":
      return updateElementInteraction(tree, operation.elementId, operation.interaction);
    case "update-binding":
      return updateElementBinding(tree, operation.elementId, operation.binding);
    case "update-a11y":
      return updateElementAccessibility(tree, operation.elementId, operation.a11y);
    case "update-custom-code":
      return updateElementCustomCode(tree, operation.elementId, operation.code);
    case "apply-preset":
      return applyElementPreset(tree, operation.elementId, operation.presetId);
    default:
      return {
        ok: false,
        error: { code: "ELEMENT_TREE_INVALID", message: "Unknown element operation." },
      };
  }
}

// ---------------------------------------------------------------------------
// Style-token parsing helper
// ---------------------------------------------------------------------------

function parseStyleTokens(record: Record<string, unknown>): ElementStyleTokens | null {
  const parsed = ElementStyleTokensSchema.safeParse(record);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Element registry (Phase P22-A)
//
// The single catalogue of every element type:
//   - element-only families (section, text, logo, …) are registered eagerly
//   - Phase O block types are derived LAZILY from the existing block registry
//     (single source of truth — element definitions never drift from block
//     definitions; the element model is an additive view on top)
//
// Framework-independent: no React, no DOM, no store. Definitions are frozen
// on registration; duplicate element-only registration is rejected
// (first wins).
// ---------------------------------------------------------------------------

import type { BlockDefinition, BlockType } from "@/features/blocks/types";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import type {
  ElementCategory,
  ElementDefinition,
  ElementOnlyType,
  ElementType,
} from "../types";
import { isElementOnlyType } from "../types";
import { schemaToValidateProps } from "./validate-props-helper";
import { GenericElementPropsSchema } from "../schemas/element-props-schemas";

// ---------------------------------------------------------------------------
// Phase P23-D — the canonical LEGACY leaf set of the custom-code authoring
// surface, retained and exported for reference/compatibility.
//
// Phase P24-C (decision D1) — this set is NO LONGER the capability gate.
// Custom-code authoring now follows renderable/durable eligibility
// (`isRenderableElementType`): every registered, renderable element type is
// eligible, while element-only families (text, logo, list, carousel,
// product-card, price, section, custom-component) remain ineligible because
// they have no renderer and no durable persistence path.
// ---------------------------------------------------------------------------

export const CUSTOM_CODE_LEAF_TYPES = new Set<BlockType>([
  "heading",
  "paragraph",
  "button",
  "badge",
  "image",
  "video",
  "icon",
]);

/** Map a Phase O block definition to its element definition (additive view). */
function deriveElementDefinitionFromBlock(
  definition: BlockDefinition,
): ElementDefinition {
  return {
    type: definition.type,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    iconKey: definition.iconKey,
    keywords: definition.keywords ?? [],
    canHaveChildren: definition.nesting.allowsChildren,
    nesting: {
      allowedChildTypes: definition.nesting.allowedChildTypes,
      minChildren: definition.nesting.minChildren,
      maxChildren: definition.nesting.maxChildren,
    },
    resizePolicy: definition.resizePolicy,
    createProps: definition.createProps,
    // Both sides are plain data factories with compatible shapes; the cast
    // bridges the block registry's looser style return type onto the element
    // style-token surface (values are sanitized at render/validation).
    createStyles: definition.createStyles as ElementDefinition["createStyles"],
    validateProps: schemaToValidateProps(GenericElementPropsSchema),
    editableFields: definition.editableFields,
    beginnerFriendly: definition.beginnerFriendly,
    editor: {
      defaultLayout: "flow",
      supportsViewportOverrides: true,
      // Phase P24-C (D1) — capability follows renderable/durable eligibility.
      // Block-derived definitions are by construction registered and renderable
      // (the block pipeline renders and persists them), so every one of them is
      // eligible. The element-only exclusion lives in `isRenderableElementType`
      // / `elementSupportsCustomCode` — the single capability rule.
      supportsCustomCode: true,
      rendererKey: definition.type,
    },
  };
}

export class ElementRegistry {
  private elementOnly = new Map<ElementOnlyType, ElementDefinition>();
  private blockCache = new Map<string, ElementDefinition>();

  /** Register an element-only definition. Block-type registration is refused. */
  register(definition: ElementDefinition): boolean {
    if (!isElementOnlyType(definition.type)) return false;
    if (this.elementOnly.has(definition.type)) return false; // first wins
    this.elementOnly.set(definition.type, Object.freeze(definition));
    return true;
  }

  get(type: ElementType): ElementDefinition | undefined {
    if (isElementOnlyType(type)) {
      return this.elementOnly.get(type);
    }
    // After the element-only guard, `type` is a block type.
    const blockType = type as BlockType;
    const cached = this.blockCache.get(blockType);
    if (cached) return cached;
    const block = blockRegistry.get(blockType);
    if (!block) return undefined;
    const derived = Object.freeze(deriveElementDefinitionFromBlock(block));
    this.blockCache.set(type, derived);
    return derived;
  }

  has(type: string): boolean {
    if (isElementOnlyType(type)) return this.elementOnly.has(type);
    return blockRegistry.has(type as BlockType);
  }

  /** Every element type in deterministic order: element-only, then blocks. */
  get types(): ElementType[] {
    return [
      ...Array.from(this.elementOnly.keys()),
      ...blockRegistry.types,
    ];
  }

  /** Every definition in deterministic order (element-only, then blocks). */
  list(): ElementDefinition[] {
    const elementOnly = Array.from(this.elementOnly.values());
    const blocks = blockRegistry.list().map((b) => this.get(b.type)).filter((d): d is ElementDefinition => !!d);
    return [...elementOnly, ...blocks];
  }

  listByCategory(category: ElementCategory): ElementDefinition[] {
    return this.list().filter((d) => d.category === category);
  }

  clear(): void {
    this.elementOnly.clear();
    this.blockCache.clear();
  }
}

/** Singleton shared across the application. */
export const elementRegistry = new ElementRegistry();

/**
 * True when a type is REGISTERED and RENDERABLE/durable (block-derived only).
 *
 * Element-only types (text, logo, list, carousel, product-card, price,
 * section, custom-component) have registry definitions + inspector schemas but
 * no renderer or durable persistence path yet (P22-D convention), so they are
 * excluded from AI element insertion and the element-AI surface. Pure and
 * deterministic — safe for server-side plan validation.
 */
export function isRenderableElementType(type: string): boolean {
  if (isElementOnlyType(type)) return false;
  return elementRegistry.has(type);
}

/**
 * True when an element type may carry user-authored custom code.
 *
 * Phase P24-C (decision D1) — the capability is now defined by
 * renderable/durable eligibility rather than a curated leaf allow-list:
 * every REGISTERED, RENDERABLE element type is eligible (containers, layout,
 * composites, interactive/form blocks, and navigation included), because the
 * P24-B durable `section.tree` gives all of them a persistence and export
 * home.
 *
 * Still ineligible — deliberately and structurally:
 *   - element-only families (text, logo, list, carousel, product-card, price,
 *     section, custom-component): registry definitions + inspector schemas but
 *     no renderer and no durable persistence path, so emitted custom code
 *     could never be rendered or persisted;
 *   - unrecognized / invalid / non-string input.
 *
 * The registry definition flag (`editor.supportsCustomCode`) mirrors this same
 * rule for derived block definitions, so the two can never disagree.
 * Pure and deterministic — safe for server-side validation.
 */
export function elementSupportsCustomCode(type: ElementType): boolean {
  if (typeof type !== "string" || type.length === 0) return false;
  return isRenderableElementType(type);
}

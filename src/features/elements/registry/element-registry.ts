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
// Phase P23-D — the curated leaf-block types eligible for user-authored custom
// code
//
// The capability is opt-in per registry definition and granted ONLY to these
// seven leaf content blocks (no children, single visual unit). Containers,
// composites, interactive/form blocks, navigation, and custom-component stay
// ineligible — custom code is never a broad capability.
// ---------------------------------------------------------------------------

const CUSTOM_CODE_LEAF_TYPES = new Set<BlockType>([
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
      // Phase P23-D — leaf content blocks only (explicit, never broad).
      supportsCustomCode: CUSTOM_CODE_LEAF_TYPES.has(definition.type),
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
 * True when an element type is explicitly allowed to carry user-authored
 * custom code (Phase P23-D). Opt-in per registry definition — never broad:
 * only types whose definition sets `editor.supportsCustomCode` qualify, and
 * the flag is granted ONLY to the curated leaf content blocks (heading,
 * paragraph, button, badge, image, video, icon). custom-component is NOT an
 * authoring vehicle for custom code. Pure and deterministic — safe for
 * server-side validation.
 */
export function elementSupportsCustomCode(type: ElementType): boolean {
  return elementRegistry.get(type)?.editor?.supportsCustomCode === true;
}

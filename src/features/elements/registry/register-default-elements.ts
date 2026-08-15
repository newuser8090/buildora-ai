// ---------------------------------------------------------------------------
// Default element registration (Phase P22-A)
//
// Registers the element-only definitions into the shared registry.
// Idempotent — safe to call from multiple entry points.
// Block types are derived lazily by the registry itself.
// ---------------------------------------------------------------------------

import { elementRegistry } from "./element-registry";
import { ELEMENT_ONLY_DEFINITIONS } from "./default-elements";

/** Register every built-in element-only definition. Idempotent. */
export function registerDefaultElements(): void {
  for (const definition of ELEMENT_ONLY_DEFINITIONS) {
    elementRegistry.register(definition);
  }
}

/** True when the element-only defaults are already registered. */
export function isDefaultElementsRegistered(): boolean {
  return elementRegistry.has("section") && elementRegistry.has("text");
}

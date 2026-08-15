// ---------------------------------------------------------------------------
// Interaction foundation (Phase P22-A) — declarative element behaviors
//
// Elements will eventually support click / hover / focus / scroll / load /
// mouse-enter-leave / custom triggers with actions such as navigate, scroll
// to section, toggle, open modal, custom action. P22-A establishes the typed,
// extensible, safe data model ONLY — no interaction editor (P22-G).
//
// Raw JavaScript is NEVER part of the default model. `custom` actions must
// reference a registered handler id (advanced, sandbox-registered later).
//
// Pure model: no React, no DOM.
// ---------------------------------------------------------------------------

import type { NavTarget } from "../navigation/types";
import type { ElementAnimation } from "../animation/types";

/** Actions an element can perform (beginner-safe; advanced = registered only). */
export type ElementAction =
  | { kind: "navigate"; target: NavTarget }
  | { kind: "scroll-to"; elementId: string }
  | { kind: "toggle"; elementId: string }
  | { kind: "open-modal"; elementId: string }
  | { kind: "start-animation"; elementId: string }
  | { kind: "submit-form"; formId: string }
  | { kind: "custom"; handlerId: string };

export interface ElementHoverEffect {
  color?: string;
  backgroundColor?: string;
  scale?: number;
  shadow?: "none" | "sm" | "md" | "lg";
  /** Hover-triggered animation (e.g. a quick scale). */
  animation?: ElementAnimation;
}

export type ElementScrollEffect =
  | { kind: "reveal"; animation: ElementAnimation }
  | { kind: "sticky"; offset?: number }
  | { kind: "parallax"; speed?: number };

export interface ElementInteraction {
  click?: ElementAction | null;
  hover?: ElementHoverEffect | null;
  focus?: ElementHoverEffect | null;
  scroll?: ElementScrollEffect | null;
  /** Run-on-load animation shortcut (mirrors animation.trigger === "load"). */
  load?: ElementAnimation | null;
}

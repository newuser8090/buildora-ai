// ---------------------------------------------------------------------------
// Interaction + animation presentation (Phase P22-G) — pure, deterministic
//
// The single resolution layer that turns the P22-A declarative model
// (ElementAnimation / ElementInteraction / NavTarget) into SAFE, renderable
// presentation information. Consumed identically by:
//   - the editor canvas (BlockRenderer)
//   - the visitor preview (non-editable BlockRenderer rendering)
//   - the exported site generator (custom-block-generator)
//
// Guarantees:
//   - framework-independent (no React, no DOM, no store)
//   - deterministic (same model + pages ⇒ same CSS/attributes every time)
//   - navigation ALWAYS resolves through the existing safe boundaries
//     (resolveNavTarget / isSafeNavUrl) — never re-parsed here
//   - hover/focus values are allow-listed before they reach CSS text
//   - only schema-approved animation types/configurations produce CSS;
//     unsupported types ("custom", sticky, parallax, …) are inert no-ops
//   - entrance (load/scroll/viewport) animations are disabled under
//     prefers-reduced-motion; hover/focus feedback remains (interaction
//     feedback must never carry critical functionality)
//
// ---------------------------------------------------------------------------

import type { Page } from "@/types/project";
import { isSafeColorValue } from "../inspector/validation";
import { isSafeNavUrl, resolveNavTarget } from "../navigation/resolve";
import type { ResolvedNavigation } from "../navigation/resolve";
import type { AnimationType } from "../animation/types";
import type {
  ElementAnimation,
  ElementHoverEffect,
  ElementInteraction,
  ElementNode,
  ElementTree,
} from "../types";

// ---------------------------------------------------------------------------
// CSS helpers
// ---------------------------------------------------------------------------

export type CssStyle = Record<string, string | number>;

function cssPropertyName(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function cssText(css: CssStyle): string {
  return Object.entries(css)
    .map(([key, value]) => `${cssPropertyName(key)}: ${value};`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Animation timing (bounded by the shared schema; defaults when absent)
// ---------------------------------------------------------------------------

export const ANIMATION_DEFAULT_DURATION_MS = 500;
export const ANIMATION_DEFAULT_DELAY_MS = 0;
export const ANIMATION_DEFAULT_EASING = "ease";

const clampMs = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), 0), 60_000);
};

export function animationDurationMs(animation: ElementAnimation): number {
  return clampMs(animation.durationMs, ANIMATION_DEFAULT_DURATION_MS);
}

export function animationDelayMs(animation: ElementAnimation): number {
  return clampMs(animation.delayMs, ANIMATION_DEFAULT_DELAY_MS);
}

export function animationEasing(animation: ElementAnimation): string {
  return typeof animation.easing === "string" && animation.easing.length > 0
    ? animation.easing
    : ANIMATION_DEFAULT_EASING;
}

export function animationIterationCount(animation: ElementAnimation): string {
  const repeat = animation.repeat;
  if (repeat === "infinite") return "infinite";
  if (typeof repeat === "number" && Number.isFinite(repeat) && repeat >= 0) {
    return String(Math.round(repeat));
  }
  return "1";
}

export function animationDirectionValue(
  animation: ElementAnimation,
): "normal" | "reverse" | "alternate" {
  return animation.direction ?? "normal";
}

// ---------------------------------------------------------------------------
// Keyframes — one deterministic set per preset type
// ---------------------------------------------------------------------------

export interface KeyframeStop {
  offset: number;
  css: CssStyle;
}

/** The keyframe stops for a preset (custom is inert — no safe representation). */
export function keyframeStopsForType(type: AnimationType): KeyframeStop[] {
  switch (type) {
    case "fade":
      return [
        { offset: 0, css: { opacity: 0 } },
        { offset: 100, css: { opacity: 1 } },
      ];
    case "slide":
      return [
        { offset: 0, css: { opacity: 0, transform: "translateY(24px)" } },
        { offset: 100, css: { opacity: 1, transform: "translateY(0)" } },
      ];
    case "scale":
      return [
        { offset: 0, css: { opacity: 0, transform: "scale(0.9)" } },
        { offset: 100, css: { opacity: 1, transform: "scale(1)" } },
      ];
    case "bounce":
      return [
        { offset: 0, css: { opacity: 0, transform: "scale(0.9)" } },
        { offset: 50, css: { transform: "scale(1.05)" } },
        { offset: 100, css: { opacity: 1, transform: "scale(1)" } },
      ];
    case "reveal":
      return [
        { offset: 0, css: { opacity: 0, clipPath: "inset(0 0 100% 0)" } },
        { offset: 100, css: { opacity: 1, clipPath: "inset(0 0 0 0)" } },
      ];
    case "blur":
      return [
        { offset: 0, css: { opacity: 0, filter: "blur(8px)" } },
        { offset: 100, css: { opacity: 1, filter: "blur(0px)" } },
      ];
    case "rotate":
      return [
        { offset: 0, css: { opacity: 0, transform: "rotate(-8deg) scale(0.95)" } },
        { offset: 100, css: { opacity: 1, transform: "rotate(0deg) scale(1)" } },
      ];
    case "custom":
      return [];
  }
}

/** Deterministic keyframes name (renderer and export must agree). */
export function keyframesName(type: AnimationType): string {
  return `ba-${type}`;
}

/** The @keyframes CSS text for a preset (empty for inert types). */
export function keyframesCssForType(type: AnimationType): string {
  const stops = keyframeStopsForType(type);
  if (stops.length === 0) return "";
  const body = stops
    .map((stop) => `  ${stop.offset}% { ${cssText(stop.css)} }`)
    .join("\n");
  return `@keyframes ${keyframesName(type)} {\n${body}\n}`;
}

/** True when a preset has no safe renderable representation. */
export function isInertAnimationType(type: AnimationType): boolean {
  return type === "custom";
}

/** The from-state of a preset (used as the reveal base / entrance start). */
export function keyframeFromState(type: AnimationType): CssStyle {
  const stops = keyframeStopsForType(type);
  return stops[0]?.css ?? {};
}

// ---------------------------------------------------------------------------
// Animation CSS values
// ---------------------------------------------------------------------------

export interface AnimationCssValues {
  name: string;
  duration: string;
  delay: string;
  timing: string;
  iteration: string;
  direction: string;
}

export function animationCssValues(animation: ElementAnimation): AnimationCssValues {
  return {
    name: keyframesName(animation.type),
    duration: `${animationDurationMs(animation)}ms`,
    delay: `${animationDelayMs(animation)}ms`,
    timing: animationEasing(animation),
    iteration: animationIterationCount(animation),
    direction: animationDirectionValue(animation),
  };
}

/** The `animation` shorthand line used in CSS rules (fill-mode both). */
export function animationShorthandLine(animation: ElementAnimation): string {
  const v = animationCssValues(animation);
  return `${v.name} ${v.duration} ${v.delay} ${v.timing} ${v.iteration} ${v.direction} both`;
}

/** Inline animation-* CSS properties (load entrances / reveal activations). */
export function animationCssProperties(animation: ElementAnimation): CssStyle {
  const v = animationCssValues(animation);
  return {
    animationName: v.name,
    animationDuration: v.duration,
    animationDelay: v.delay,
    animationTimingFunction: v.timing,
    animationIterationCount: v.iteration,
    animationDirection: v.direction,
    animationFillMode: "both",
  };
}

// ---------------------------------------------------------------------------
// Animation presentation (per element)
// ---------------------------------------------------------------------------

export type RevealKind = "load" | "scroll";

export interface AnimationPresentation {
  /** The animation that governs this element (null when none/inert). */
  animation: ElementAnimation | null;
  /** Entrance mechanism ("scroll" = IntersectionObserver reveal). */
  reveal: RevealKind | null;
  /** Inline CSS properties for the animation itself (load entrances). */
  inlineStyle: CssStyle;
  /** Inline base (from-state) style for reveal entrances — applied until shown. */
  baseStyle: CssStyle;
  /** A CSS rule that triggers the animation on hover/press (hover/click triggers). */
  triggerCss: string;
  /** The @keyframes CSS for this element's animation (empty when inert). */
  keyframesCss: string;
  /** Data attributes to place on the element. */
  attributes: Record<string, string>;
}

/** The element's effective animation (explicit animation > scroll reveal > load shortcut). */
export function effectiveAnimationForNode(
  node: ElementNode,
): { animation: ElementAnimation; trigger: "load" | "scroll" | "hover" | "click" } | null {
  if (node.animation) {
    if (isInertAnimationType(node.animation.type)) return null;
    const trigger = node.animation.trigger;
    if (trigger === "load" || trigger === "scroll" || trigger === "viewport") {
      return {
        animation: node.animation,
        trigger: trigger === "load" ? "load" : "scroll",
      };
    }
    if (trigger === "hover" || trigger === "click") {
      return { animation: node.animation, trigger };
    }
    return null;
  }
  const scroll = node.interaction?.scroll;
  if (scroll && scroll.kind === "reveal" && scroll.animation && !isInertAnimationType(scroll.animation.type)) {
    return { animation: scroll.animation, trigger: "scroll" };
  }
  const load = node.interaction?.load;
  if (load && !isInertAnimationType(load.type)) {
    return { animation: load, trigger: "load" };
  }
  return null;
}

/** Resolve one element's animation into safe presentation information. */
export function resolveAnimationPresentation(node: ElementNode): AnimationPresentation {
  const effective = effectiveAnimationForNode(node);
  const empty: AnimationPresentation = {
    animation: null,
    reveal: null,
    inlineStyle: {},
    baseStyle: {},
    triggerCss: "",
    keyframesCss: "",
    attributes: {},
  };
  if (!effective) return empty;

  const { animation, trigger } = effective;
  const id = node.id;
  const keyframes = keyframesCssForType(animation.type);

  // ---- Entrance (load) — inline animation, fill-mode both ----
  if (trigger === "load") {
    return {
      animation,
      reveal: "load",
      inlineStyle: animationCssProperties(animation),
      baseStyle: {},
      triggerCss: "",
      keyframesCss: keyframes,
      attributes: { "data-ba-anim": "load" },
    };
  }

  // ---- Entrance (scroll / viewport) — reveal via IntersectionObserver ----
  if (trigger === "scroll") {
    return {
      animation,
      reveal: "scroll",
      inlineStyle: {},
      baseStyle: keyframeFromState(animation.type),
      triggerCss:
        `[data-ba-reveal="${id}"].ba-reveal-in {\n` +
        `  animation: ${animationShorthandLine(animation)};\n` +
        `}`,
      keyframesCss: keyframes,
      attributes: { "data-ba-anim": "scroll", "data-ba-reveal": id },
    };
  }

  // ---- Interaction-triggered (hover / click) — pure CSS pseudo-classes ----
  const selector = trigger === "hover" ? ":hover" : ":active";
  return {
    animation,
    reveal: null,
    inlineStyle: {},
    baseStyle: {},
    triggerCss:
      `[data-block-id="${id}"]${selector} {\n` +
      `  animation: ${animationShorthandLine(animation)};\n` +
      `}`,
    keyframesCss: keyframes,
    attributes: { "data-ba-anim": trigger === "hover" ? "hover" : "click" },
  };
}

// ---------------------------------------------------------------------------
// Interaction presentation (per element)
// ---------------------------------------------------------------------------

export interface ResolvedClickAction {
  kind: "navigate" | "scroll-to";
  /** Safe href for navigate (only when safe). */
  href?: string;
  resolvedKind?: ResolvedNavigation["kind"];
  /** Target element id for scroll-to. */
  scrollElementId?: string;
  /** True when the action resolves to a real, safe behavior. */
  safe: boolean;
}

export interface InteractionPresentation {
  click: ResolvedClickAction | null;
  /** CSS rule for the :hover effect (empty when none). */
  hoverCss: string;
  /** CSS rule for the :focus-visible effect (empty when none). */
  focusCss: string;
  /** True when a focus interaction exists (element should be keyboard-focusable). */
  focusable: boolean;
  /** Base inline styles supporting hover/focus transforms (e.g. rotation). */
  baseStyle: CssStyle;
}

/** Map a hover-effect shadow token to a theme-safe CSS value. */
export function hoverShadowToken(shadow: string | undefined): string | null {
  if (shadow === undefined) return null;
  switch (shadow) {
    case "none":
      return "none";
    case "sm":
      return "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))";
    case "md":
      return "var(--shadow-md, 0 4px 6px rgba(0,0,0,0.07))";
    case "lg":
      return "var(--shadow-lg, 0 10px 15px rgba(0,0,0,0.1))";
    default:
      return null;
  }
}

const HOVER_TRANSITION =
  "transform 150ms ease, color 150ms ease, background-color 150ms ease, box-shadow 150ms ease";

/** Build the CSS declarations for a hover/focus effect (allow-listed values). */
function hoverEffectDeclarations(effect: ElementHoverEffect): {
  declarations: string[];
  transition: boolean;
} {
  const declarations: string[] = [];
  let transition = false;
  if (typeof effect.color === "string" && effect.color.length > 0 && isSafeColorValue(effect.color)) {
    declarations.push(`color: ${effect.color.trim()};`);
    transition = true;
  }
  if (
    typeof effect.backgroundColor === "string" &&
    effect.backgroundColor.length > 0 &&
    isSafeColorValue(effect.backgroundColor)
  ) {
    declarations.push(`background-color: ${effect.backgroundColor.trim()};`);
    transition = true;
  }
  const shadow = hoverShadowToken(effect.shadow);
  if (shadow !== null) {
    declarations.push(`box-shadow: ${shadow};`);
    transition = true;
  }
  if (typeof effect.scale === "number" && Number.isFinite(effect.scale) && effect.scale !== 1) {
    // `--ba-ht` is defined inline on the element when a rotation must survive
    // the hover transform; the fallback is the plain scale.
    declarations.push(`transform: var(--ba-ht, scale(${effect.scale}));`);
    transition = true;
  }
  return { declarations, transition };
}

/** Resolve the element's hover/focus effect CSS + focusability. */
function resolveHoverFocus(node: ElementNode): {
  hoverCss: string;
  focusCss: string;
  focusable: boolean;
} {
  const interaction: ElementInteraction | undefined = node.interaction;
  const id = node.id;
  const hover = interaction?.hover ?? null;
  const focus = interaction?.focus ?? null;

  const hoverEffect = hover && Object.keys(hover).length > 0 ? hover : null;
  const focusEffect = focus && Object.keys(focus).length > 0 ? focus : null;

  const hoverCss = hoverEffect
    ? buildEffectRule(id, ":hover", hoverEffect)
    : "";
  const focusCss = focusEffect
    ? buildEffectRule(id, ":focus-visible", focusEffect)
    : "";
  const focusable = focusEffect !== null;

  return { hoverCss, focusCss, focusable };
}

function buildEffectRule(id: string, pseudo: string, effect: ElementHoverEffect): string {
  const { declarations, transition } = hoverEffectDeclarations(effect);
  if (declarations.length === 0) return "";
  const lines = [
    `[data-block-id="${id}"]${pseudo} {`,
    ...(transition ? [`  transition: ${HOVER_TRANSITION};`] : []),
    ...declarations.map((declaration) => `  ${declaration}`),
    `}`,
  ];
  return lines.join("\n");
}

/** Resolve a click → navigate action against the project's pages. */
function resolveNavigateAction(
  target: Extract<ElementInteraction["click"], { kind: "navigate" }>["target"],
  pages: Page[],
): ResolvedClickAction {
  const resolved = resolveNavTarget(target, pages);
  if (resolved.unresolved) {
    return { kind: "navigate", href: "#", safe: false };
  }
  // Defense-in-depth: never trust the resolved href beyond the safe policy
  // (resolveNavTarget already rejects unsafe schemes; this is the second gate).
  if (!isSafeNavUrl(resolved.href)) {
    return { kind: "navigate", href: "#", safe: false };
  }
  return {
    kind: "navigate",
    href: resolved.href,
    resolvedKind: resolved.kind,
    safe: true,
  };
}

/** Resolve the element's click action (navigation / scroll-to). */
function resolveClickAction(
  node: ElementNode,
  tree: ElementTree,
  pages: Page[],
): ResolvedClickAction | null {
  const click = node.interaction?.click;
  if (!click) return null;
  if (click.kind === "navigate") {
    return resolveNavigateAction(click.target, pages);
  }
  if (click.kind === "scroll-to") {
    // Scroll targets resolve only within the element's own tree (deterministic;
    // cross-tree section scrolling is out of P22-G scope).
    const exists = tree.nodes[click.elementId] !== undefined;
    return {
      kind: "scroll-to",
      scrollElementId: click.elementId,
      safe: exists,
    };
  }
  // toggle / open-modal / submit-form / custom / start-animation are EXPLICITLY
  // deferred in P22-G — they never produce renderable behavior.
  return null;
}

/** Resolve one element's interaction into safe presentation information. */
export function resolveInteractionPresentation(
  node: ElementNode,
  tree: ElementTree,
  pages: Page[],
): InteractionPresentation {
  const click = resolveClickAction(node, tree, pages);
  const { hoverCss, focusCss, focusable } = resolveHoverFocus(node);

  // A rotation on the element must survive the hover/focus transform — the
  // rule references `--ba-ht` (fallback scale), so define it inline.
  const baseStyle: CssStyle = {};
  const hasScaleHover =
    (node.interaction?.hover && typeof node.interaction.hover.scale === "number" && node.interaction.hover.scale !== 1) ||
    (node.interaction?.focus && typeof node.interaction.focus.scale === "number" && node.interaction.focus.scale !== 1);
  const rotation = node.geometry?.rotation;
  if (hasScaleHover && typeof rotation === "number" && Number.isFinite(rotation) && rotation !== 0) {
    baseStyle["--ba-ht"] = `rotate(${rotation}deg)`;
  }
  if (hoverCss || focusCss) {
    baseStyle.transition = HOVER_TRANSITION;
  }

  return { click, hoverCss, focusCss, focusable, baseStyle };
}

// ---------------------------------------------------------------------------
// Tree-level presentation (one <style> for the whole tree)
// ---------------------------------------------------------------------------

export interface TreePresentation {
  /** Complete <style> content (keyframes + rules + reduced-motion guard). */
  cssText: string;
  /** True when any node needs the scroll-reveal IntersectionObserver. */
  needsRevealObserver: boolean;
}

/** True when a tree carries any animation/interaction data at all. */
export function treeHasDynamicPresentation(tree: ElementTree): boolean {
  for (const node of Object.values(tree.nodes)) {
    if (!node) continue;
    if (node.animation || node.interaction) return true;
  }
  return false;
}

/** Build the full presentation CSS for a tree (deterministic id order). */
export function presentTree(tree: ElementTree, pages: Page[]): TreePresentation {
  const keyframes = new Set<string>();
  const rules: string[] = [];
  let needsRevealObserver = false;
  let hasEntrance = false;

  const ids = Object.keys(tree.nodes).sort();
  for (const id of ids) {
    const node = tree.nodes[id];
    if (!node) continue;

    const animation = resolveAnimationPresentation(node);
    if (animation.keyframesCss) keyframes.add(animation.keyframesCss);
    if (animation.triggerCss) rules.push(animation.triggerCss);
    if (animation.reveal) {
      needsRevealObserver = needsRevealObserver || animation.reveal === "scroll";
      hasEntrance = true;
    }
    if (animation.inlineStyle.animationName) hasEntrance = true;

    const interaction = resolveInteractionPresentation(node, tree, pages);
    if (interaction.hoverCss) rules.push(interaction.hoverCss);
    if (interaction.focusCss) rules.push(interaction.focusCss);
  }

  const parts: string[] = [...keyframes, ...rules];
  if (hasEntrance) {
    parts.push(
      `@media (prefers-reduced-motion: reduce) {\n` +
        `  [data-ba-anim="load"] { animation: none !important; }\n` +
        `  [data-ba-anim="scroll"] { animation: none !important; opacity: 1 !important; }\n` +
        `}`,
    );
  }

  return { cssText: parts.join("\n"), needsRevealObserver };
}

// ---------------------------------------------------------------------------
// Navigation helpers reused by the renderer (framework-agnostic click behavior)
// ---------------------------------------------------------------------------

/** Scroll an element into view by its block id (bounded, reduced-motion aware). */
export function scrollElementIntoView(elementId: string): void {
  const element = document.getElementById(elementId);
  if (!element) return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView(reduce ? {} : { behavior: "smooth" });
}

/** Perform a resolved click action (navigate / scroll-to / back). */
export function performClickAction(action: ResolvedClickAction): void {
  if (!action.safe) return;
  if (action.kind === "scroll-to") {
    if (action.scrollElementId) scrollElementIntoView(action.scrollElementId);
    return;
  }
  const href = action.href ?? "#";
  switch (action.resolvedKind) {
    case "external":
      window.open(href, "_blank", "noopener,noreferrer");
      break;
    case "back":
      window.history.back();
      break;
    case "internal":
    case "email":
    case "phone":
    default:
      window.location.assign(href);
      break;
  }
}

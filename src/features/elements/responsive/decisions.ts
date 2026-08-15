// ---------------------------------------------------------------------------
// Responsive decision engine (Phase P22-F)
//
// The rule-based "responsive intelligence": a pure analysis layer that
// proposes responsive decisions for a tree, a validated decision vocabulary,
// and the application/recording primitives. NO auto-apply happens here — the
// UI surfaces proposals and the user accepts or dismisses each one; dismissed
// proposals are recorded so the engine never re-suggests them (user overrides
// always win, persisted in the document).
//
// Rules are deterministic and conservative: every proposal maps to an EXISTING
// style token the canvas/thumbnail/export renderers already consume, so
// applying a decision is always renderer-supported (WYSIWYG by construction).
//
// Pure model: no React, no DOM, no store.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { updateElementViewport } from "../engine/element-operations";
import type { ElementResult, ElementStyleTokens, ElementTree } from "../types";
import {
  RESPONSIVE_TRANSFORMATIONS,
  type ElementViewportKey,
  type ResponsiveDecision,
  type ResponsiveTransformation,
} from "./types";

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Persisted decision history cap (bounded; oldest dropped beyond this). */
export const MAX_RESPONSIVE_DECISIONS = 200;

// ---------------------------------------------------------------------------
// Schema (the hard validation boundary — no arbitrary transformation strings)
// ---------------------------------------------------------------------------

export const ResponsiveTransformationSchema = z.enum(RESPONSIVE_TRANSFORMATIONS);

export const ResponsiveDecisionSchema = z.object({
  elementId: z.string().min(1).max(120),
  viewport: z.enum(["tablet", "mobile"]),
  transformation: ResponsiveTransformationSchema,
  appliedBy: z.enum(["ai", "user"]),
  state: z.enum(["applied", "rejected"]).default("applied"),
  note: z.string().max(200).optional(),
});

export const ResponsiveDecisionsSchema = z
  .array(ResponsiveDecisionSchema)
  .max(MAX_RESPONSIVE_DECISIONS);

// ---------------------------------------------------------------------------
// Parsers (shared by the engine, the inspector resolver and the exporter)
// ---------------------------------------------------------------------------

/** Parse a px font size value ("40px" | 40) or null when not parseable. */
export function parsePxFontSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)px$/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

/** Parse the column count from a `repeat(N, minmax(0, 1fr))` token. */
export function parseGridTemplateColumnsCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^repeat\(\s*(\d+)\s*,/);
  return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Normalization / repair (persistence boundary)
// ---------------------------------------------------------------------------

/**
 * Repair an unknown value into a bounded array of VALID decisions. Invalid or
 * unknown transformations are dropped (never coerced) — the allow-list is the
 * only vocabulary the document accepts.
 */
export function normalizeResponsiveDecisions(input: unknown): ResponsiveDecision[] {
  if (!Array.isArray(input)) return [];
  const out: ResponsiveDecision[] = [];
  for (const item of input) {
    const parsed = ResponsiveDecisionSchema.safeParse(item);
    if (parsed.success) {
      out.push(parsed.data);
      if (out.length >= MAX_RESPONSIVE_DECISIONS) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/**
 * Record a decision: a new decision for the same (element, viewport,
 * transformation) REPLACES the earlier one; the list is capped (oldest
 * dropped first beyond the bound).
 */
export function recordResponsiveDecision(
  decisions: ResponsiveDecision[],
  decision: ResponsiveDecision,
): ResponsiveDecision[] {
  const next = decisions.filter(
    (d) =>
      !(
        d.elementId === decision.elementId &&
        d.viewport === decision.viewport &&
        d.transformation === decision.transformation
      ),
  );
  next.push(decision);
  return next.length > MAX_RESPONSIVE_DECISIONS
    ? next.slice(next.length - MAX_RESPONSIVE_DECISIONS)
    : next;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** A candidate suggestion before user accept/reject. */
export interface ResponsiveProposal {
  elementId: string;
  viewport: ElementViewportKey;
  transformation: ResponsiveTransformation;
  /** User-facing one-line explanation. */
  note: string;
}

/** Direct children of a node that are not hidden. */
function visibleChildCount(node: {
  children: string[];
  hidden?: boolean;
}, nodes: ElementTree["nodes"]): number {
  return node.children.filter((id) => {
    const child = nodes[id];
    return child && child.hidden !== true;
  }).length;
}

/** True when the node renders children horizontally (row or flex row). */
function isHorizontalLayout(node: { type: string; style?: Record<string, unknown> }): boolean {
  if (node.type === "row") return true;
  // Only flex containers with a row direction are stackable; block/static
  // nodes (headings, paragraphs, plain containers) never qualify.
  if (node.style?.display !== "flex") return false;
  const direction = node.style.flexDirection;
  return direction === undefined || direction === "row" || direction === "row-reverse";
}

/**
 * Propose responsive decisions for a tree at a viewport. Deterministic and
 * conservative; returns raw candidates (call suppressResponsiveProposals to
 * honor persisted user decisions before showing them).
 */
export function proposeResponsiveDecisions(
  tree: ElementTree,
  viewport: ElementViewportKey,
): ResponsiveProposal[] {
  const proposals: ResponsiveProposal[] = [];
  for (const node of Object.values(tree.nodes)) {
    if (!node || node.hidden === true || node.locked === true) continue;
    const override = node.viewport?.[viewport];

    // ---- Grids: fewer columns on narrow viewports ----
    if (node.type === "grid") {
      if (override?.gridTemplateColumns !== undefined) continue; // already responsive
      const columns =
        typeof node.props.columns === "number"
          ? Math.min(Math.max(Math.round(node.props.columns), 1), 6)
          : 3;
      if (viewport === "tablet" && columns > 2) {
        proposals.push({
          elementId: node.id,
          viewport,
          transformation: "grid-columns-2",
          note: "Show 2 columns on tablet",
        });
      } else if (viewport === "mobile" && columns > 1) {
        proposals.push({
          elementId: node.id,
          viewport,
          transformation: "grid-columns-1",
          note: "Show 1 column on mobile",
        });
      }
      continue;
    }

    // ---- Horizontal rows: stack on mobile ----
    if (viewport === "mobile" && isHorizontalLayout(node)) {
      if (override?.flexDirection === "column") continue; // already stacked
      if (visibleChildCount(node, tree.nodes) > 3) {
        proposals.push({
          elementId: node.id,
          viewport,
          transformation: "stack",
          note: "Stack items vertically on mobile",
        });
      }
      continue;
    }

    // ---- Large text: reduce on mobile ----
    if (viewport === "mobile" && override?.fontSize === undefined) {
      if (
        node.type === "heading" ||
        node.type === "paragraph" ||
        node.type === "button" ||
        node.type === "badge" ||
        node.type === "text"
      ) {
        const basePx = parsePxFontSize(node.style?.fontSize);
        if (basePx !== null && basePx >= 32) {
          proposals.push({
            elementId: node.id,
            viewport,
            transformation: "font-size-smaller",
            note: "Use a smaller font on mobile",
          });
        }
      }
    }
  }
  return proposals;
}

/**
 * Filter proposals against persisted decisions:
 *  - a USER decision for the (element, viewport) suppresses ALL proposals for
 *    that pair (the user took ownership — never re-suggest);
 *  - an APPLIED decision for the exact (element, viewport, transformation)
 *    suppresses re-offering the same change;
 *  - a REJECTED decision for the exact triple suppresses it permanently.
 */
export function suppressResponsiveProposals(
  proposals: ResponsiveProposal[],
  decisions: ResponsiveDecision[],
): ResponsiveProposal[] {
  return proposals.filter((proposal) => {
    const userOwned = decisions.some(
      (d) =>
        d.elementId === proposal.elementId &&
        d.viewport === proposal.viewport &&
        d.appliedBy === "user",
    );
    if (userOwned) return false;
    const sameTriple = decisions.some(
      (d) =>
        d.elementId === proposal.elementId &&
        d.viewport === proposal.viewport &&
        d.transformation === proposal.transformation,
    );
    return !sameTriple;
  });
}

// ---------------------------------------------------------------------------
// Application — writes the viewport override through the EXISTING element op
// ---------------------------------------------------------------------------

/** The style-token override a transformation maps to. */
export function transformationToViewportStyle(
  decision: Pick<ResponsiveDecision, "elementId" | "transformation">,
  tree: ElementTree,
): ElementStyleTokens | null {
  switch (decision.transformation) {
    case "grid-columns-2":
      return { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } as ElementStyleTokens;
    case "grid-columns-1":
      return { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } as ElementStyleTokens;
    case "stack":
      return { flexDirection: "column" } as ElementStyleTokens;
    case "font-size-smaller": {
      const basePx = parsePxFontSize(tree.nodes[decision.elementId]?.style?.fontSize);
      if (basePx === null) return null; // nothing to reduce — no-op
      return { fontSize: Math.max(10, Math.round(basePx * 0.75)) } as ElementStyleTokens;
    }
    default:
      return null; // unknown transformation — never applied
  }
}

/**
 * Apply a decision to the tree: writes the viewport override for the target
 * element at the decision's viewport. Validated through the existing
 * `updateElementViewport` op (locked / unknown-element / invalid-style all
 * return structured errors). Returns the tree unchanged for transformations
 * that have nothing to apply.
 */
export function applyResponsibleDecision(
  tree: ElementTree,
  decision: ResponsiveDecision,
): ElementResult<ElementTree> {
  const style = transformationToViewportStyle(decision, tree);
  if (!style) return { ok: true, value: tree };
  return updateElementViewport(tree, decision.elementId, decision.viewport, style);
}

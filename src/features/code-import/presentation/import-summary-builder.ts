// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — friendly import summary builder
//
// Presentation-layer mapping from converted BlockTree types into the
// beginner-facing groups shown in the Import Studio ("We found:").
//
// Rules:
//   - deterministic (input order → canonical output order)
//   - never mutates the input tree
//   - layout-only types (container/row/column/grid/stack/divider/spacer) are
//     hidden from the beginner summary unless they carry visible content
//   - output is capped (configurable) so huge imports stay readable
//   - the advanced view may read the exact block type counts from the report
// ---------------------------------------------------------------------------

import type { BlockTree } from "@/features/blocks/types";
import { allNodes } from "@/features/blocks/engine/tree-traversal";

// ---------------------------------------------------------------------------
// Friendly label mapping
// ---------------------------------------------------------------------------

export const FRIENDLY_BLOCK_LABELS: Record<string, string> = {
  navbar: "Top navigation",
  heading: "Heading",
  paragraph: "Text",
  button: "Button",
  image: "Image",
  video: "Video",
  icon: "Icon",
  badge: "Badge",
  form: "Form",
  input: "Input",
  textarea: "Text area",
  checkbox: "Checkbox",
  tabs: "Tabs",
  accordion: "Accordion",
  card: "Card",
  "pricing-card": "Pricing card",
  "feature-card": "Feature card",
  "review-card": "Customer review",
  "faq-item": "Question and answer",
  "team-member": "Team member",
  menu: "Menu",
  footer: "Footer",
  container: "Container",
  row: "Row",
  column: "Column",
  grid: "Grid",
  stack: "Stack",
  divider: "Divider",
  spacer: "Spacer",
};

/** Layout-only types hidden from the beginner summary by default. */
const HIDDEN_LAYOUT_TYPES = new Set([
  "container",
  "row",
  "column",
  "grid",
  "stack",
  "divider",
  "spacer",
]);

/** Beginner-friendly label for one block type (fallback-safe). */
export function friendlyBlockLabel(type: string): string {
  return FRIENDLY_BLOCK_LABELS[type] ?? type;
}

/** Pluralise a friendly label for count > 1. */
export function pluralizeFriendlyLabel(label: string, count: number): string {
  if (count === 1) return label;
  const irregular: Record<string, string> = {
    "Question and answer": "Questions and answers",
    "Customer review": "Customer reviews",
    "Pricing card": "Pricing cards",
    "Feature card": "Feature cards",
    "Team member": "Team members",
    "Text area": "Text areas",
    "Top navigation": "Top navigation",
    "Menu": "Menus",
    "Form": "Forms",
    "Input": "Inputs",
    "Checkbox": "Checkboxes",
    "Tabs": "Tabs",
    "Accordion": "Accordions",
    "Heading": "Headings",
    "Text": "Text blocks",
    "Button": "Buttons",
    "Image": "Images",
    "Video": "Videos",
    "Icon": "Icons",
    "Badge": "Badges",
    "Card": "Cards",
    "Footer": "Footers",
  };
  return irregular[label] ?? `${label}s`;
}

// ---------------------------------------------------------------------------
// Summary model
// ---------------------------------------------------------------------------

export interface FriendlySummaryItem {
  /** Friendly label (singular). */
  label: string;
  /** Friendly label rendered for the count (pluralised when needed). */
  displayLabel: string;
  count: number;
  /** Internal block types that map to this group. */
  blockTypes: string[];
}

export interface FriendlyImportSummary {
  items: FriendlySummaryItem[];
  totalBlocks: number;
  /** True when the item list was capped for display. */
  capped: boolean;
}

/**
 * Build the beginner-friendly summary for a converted tree.
 *
 * Deterministic ordering: group by friendly label, order by count desc, then
 * by label asc, then by first-seen block type. Hidden layout types only
 * count toward the total, never the summary items.
 */
export function buildFriendlyImportSummary(
  tree: BlockTree,
  options: { cap?: number; includeLayout?: boolean } = {},
): FriendlyImportSummary {
  const cap = options.cap ?? 8;
  const includeLayout = options.includeLayout ?? false;

  const counts = new Map<string, { label: string; count: number; blockTypes: string[] }>();
  let totalBlocks = 0;

  for (const node of allNodes(tree)) {
    totalBlocks += 1;
    if (!includeLayout && HIDDEN_LAYOUT_TYPES.has(node.type)) continue;
    const label = friendlyBlockLabel(node.type);
    const entry = counts.get(label);
    if (entry) {
      entry.count += 1;
      if (!entry.blockTypes.includes(node.type)) entry.blockTypes.push(node.type);
    } else {
      counts.set(label, { label, count: 1, blockTypes: [node.type] });
    }
  }

  const items: FriendlySummaryItem[] = Array.from(counts.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      return 0;
    })
    .map((entry) => ({
      label: entry.label,
      displayLabel: pluralizeFriendlyLabel(entry.label, entry.count),
      count: entry.count,
      blockTypes: entry.blockTypes,
    }));

  const capped = items.length > cap;

  return {
    items: items.slice(0, cap),
    totalBlocks,
    capped,
  };
}

/**
 * The canonical "We found:" list — a deterministic sequence of friendly
 * item labels (singular when count is 1, pluralised otherwise).
 */
export function friendlyFoundList(tree: BlockTree, cap = 8): string[] {
  return buildFriendlyImportSummary(tree, { cap }).items.map(
    (item) => item.displayLabel,
  );
}

/** Friendly summary for one block type (used by the review step). */
export function friendlyItemSentence(
  label: string,
  count: number,
): string {
  return count === 1 ? label : pluralizeFriendlyLabel(label, count);
}

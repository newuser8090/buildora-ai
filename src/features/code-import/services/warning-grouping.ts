// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — warning grouping
//
// Groups the consolidated ConversionReport findings into the five
// beginner-facing buckets shown in the Import Studio Review step:
//   Removed for safety / Could not be converted / Converted approximately /
//   Needs your attention / Asset and link warnings
//
// Each item carries a friendly explanation plus the raw technical detail
// (surfaced under an expandable "Advanced" section). Source locations are
// merged back from the P1 analysis when available. Deterministic and pure.
// ---------------------------------------------------------------------------

import type { CodeImportAnalysis, ImportSourceLocation } from "../types";
import type { ConversionReport } from "../conversion/conversion-report";

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

export type WarningBucketId =
  | "removed"
  | "unsupported"
  | "approximated"
  | "attention"
  | "assets";

export interface WarningGroupItem {
  code: string;
  message: string;
  path?: string;
  sourceLocation?: ImportSourceLocation;
  /** Beginner-facing explanation. */
  friendly: string;
}

export interface WarningGroup {
  id: WarningBucketId;
  label: string;
  description: string;
  items: WarningGroupItem[];
}

export interface WarningGrouping {
  groups: WarningGroup[];
  total: number;
}

// ---------------------------------------------------------------------------
// Code buckets (from the P1/P2 code sets)
// ---------------------------------------------------------------------------

/** Removed for safety — runtime behaviour or content removed, nothing executed. */
const REMOVED_CODES = new Set([
  "event-handler-removed",
  "script-removed",
  "style-element-removed",
  "iframe-removed",
  "object-embed-removed",
  "dangerously-set-inner-html",
  "spread-props-removed",
  "raw-script-text",
  "dangerous-key",
  "css-expression-rejected",
  "css-behavior-property-rejected",
]);

/** Converted approximately — a safe approximation replaced the original. */
const APPROXIMATED_CODES = new Set([
  "mapping-approximation",
  "table-unsupported",
  "iframe-placeholder",
  "radio-to-checkbox",
  "select-to-input",
  "video-placeholder",
  "custom-component-inlined",
  "ambiguous-component-selection",
]);

/** Asset/link warnings — URLs, images, links that could not be preserved. */
const ASSET_LINK_CODES = new Set([
  "unsafe-url",
  "data-url-not-enabled",
  "css-import-rejected",
  "image-unresolved",
  "link-unresolved",
  "url-rejected",
  "inline-style-dropped",
]);

// ---------------------------------------------------------------------------
// Friendly explanations
// ---------------------------------------------------------------------------

const FRIENDLY_EXPLANATIONS: Record<string, string> = {
  "event-handler-removed": "An interactive click action was removed. You can add a link or action later.",
  "script-removed": "A script was removed for safety — it is never run.",
  "style-element-removed": "A style element was removed for safety.",
  "iframe-removed": "An embedded frame was removed — it is not run inside Buildora.",
  "object-embed-removed": "An embedded object was removed for safety.",
  "dangerously-set-inner-html": "Raw HTML injection was removed for safety.",
  "spread-props-removed": "Unknown extra settings were removed because they could carry unsafe code.",
  "raw-script-text": "Inline script text was removed for safety.",
  "dangerous-key": "A protected property name was rejected for safety.",
  "css-expression-rejected": "A CSS expression was removed because it can run code.",
  "css-behavior-property-rejected": "A CSS behavior rule was removed because it can run code.",
  "mapping-approximation": "This element became a similar building block.",
  "table-unsupported": "Tables are not editable yet — this became a container.",
  "iframe-placeholder": "The embedded frame was replaced with a placeholder you can edit.",
  "custom-component-inlined": "This custom component was converted to building blocks instead of running its code.",
  "ambiguous-component-selection": "Buildora picked the most likely version of this component.",
  "unsafe-url": "An unsafe link was removed or replaced.",
  "data-url-not-enabled": "A data link was not carried over.",
  "css-import-rejected": "An imported stylesheet was not applied.",
  "inline-style-dropped": "A style declaration was dropped for safety.",
  "hook-usage-unsupported": "Interactive logic (a hook) was not carried over — the layout remains editable.",
  "network-call-unsupported": "A network request was not carried over.",
  "eval-detected": "Code that evaluates other code was removed.",
  "function-constructor-detected": "A dangerous function constructor was removed.",
  "document-write-detected": "Direct document writing was removed.",
  "window-location-mutation": "Page-redirecting code was removed.",
  "dynamic-expression-unsupported": "A dynamic expression was replaced with static content.",
  "unresolved-identifier": "A value that could not be resolved was replaced with a placeholder.",
  "custom-component-unsupported": "An external React component could not be imported because it requires running code.",
  "external-import-ignored": "An external import was ignored — nothing was downloaded or run.",
  "dynamic-import-ignored": "A dynamic import was ignored for safety.",
  "require-ignored": "A require() call was ignored for safety.",
  "css-at-rule-ignored": "A CSS at-rule was ignored.",
  "css-malformed-declaration": "A malformed CSS declaration was skipped.",
};

function friendlyExplanation(code: string, message: string): string {
  const known = FRIENDLY_EXPLANATIONS[code];
  if (known) return known;
  // Asset/link fallbacks.
  if (code.includes("url") || code.includes("link") || code.includes("image")) {
    return "A link or image could not be preserved and was replaced safely.";
  }
  if (message && message.length > 0) {
    return message;
  }
  return "This part could not be converted exactly and was handled safely.";
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface WarningGroupingInput {
  report: ConversionReport;
  analysis?: CodeImportAnalysis | null;
}

interface RawItem {
  code: string;
  message: string;
  path?: string;
}

/** Merge P1 source locations back into report items (best-effort). */
function findSourceLocation(
  analysis: CodeImportAnalysis | null | undefined,
  code: string,
  message: string,
): ImportSourceLocation | undefined {
  if (!analysis) return undefined;
  const match = analysis.securityFindings.find(
    (f) => f.code === code && f.message === message,
  );
  return match?.sourceLocation;
}

/** Build the grouped warnings. Deterministic bucket order. */
export function groupWarnings(input: WarningGroupingInput): WarningGrouping {
  const { report } = input;

  const bucketFor = (item: RawItem): WarningBucketId => {
    if (REMOVED_CODES.has(item.code)) return "removed";
    if (ASSET_LINK_CODES.has(item.code)) return "assets";
    if (APPROXIMATED_CODES.has(item.code)) return "approximated";
    if (item.code === "hook-usage-unsupported" || item.code === "network-call-unsupported") {
      return "unsupported";
    }
    return "attention";
  };

  const toItem = (item: RawItem): WarningGroupItem => ({
    code: item.code,
    message: item.message,
    path: item.path,
    sourceLocation: findSourceLocation(input.analysis, item.code, item.message),
    friendly: friendlyExplanation(item.code, item.message),
  });

  const raw: RawItem[] = [
    ...report.replacedRuntimeBehavior.map((r) => ({ code: r.code, message: r.message, path: r.path })),
    ...report.unsupportedConstructs.map((u) => ({ code: u.code, message: u.message, path: u.path })),
    ...report.ignoredCode.map((i) => ({ code: i.code, message: i.message, path: i.path })),
    ...report.warnings.map((w) => ({ code: w.code, message: w.message, path: w.path })),
  ];

  // De-duplicate identical entries (code + message + path).
  const seen = new Set<string>();
  const unique: RawItem[] = [];
  for (const item of raw) {
    const key = `${item.code}\u0000${item.message}\u0000${item.path ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  const groups: WarningGroup[] = [
    {
      id: "removed",
      label: "Removed for safety",
      description: "Things that were not run, and were removed so nothing unsafe happens.",
      items: [],
    },
    {
      id: "unsupported",
      label: "Could not be converted",
      description: "Parts that need running code and were left out of the editable result.",
      items: [],
    },
    {
      id: "approximated",
      label: "Converted approximately",
      description: "Parts that became a close, editable version of the original.",
      items: [],
    },
    {
      id: "assets",
      label: "Asset and link warnings",
      description: "Images or links that could not be preserved exactly.",
      items: [],
    },
    {
      id: "attention",
      label: "Needs your attention",
      description: "Small notes worth reviewing before you finish.",
      items: [],
    },
  ];

  for (const item of unique) {
    const bucket = bucketFor(item);
    const group = groups.find((g) => g.id === bucket);
    if (group) group.items.push(toItem(item));
  }

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  return { groups, total };
}

/** Count the items in the two safety-critical buckets. */
export function countRemovedAndUnsupported(grouping: WarningGrouping): {
  removed: number;
  unsupported: number;
} {
  const removed = grouping.groups.find((g) => g.id === "removed")?.items.length ?? 0;
  const unsupported = grouping.groups.find((g) => g.id === "unsupported")?.items.length ?? 0;
  return { removed, unsupported };
}

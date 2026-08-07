// ---------------------------------------------------------------------------
// Preview navigation — safe action semantics (Phase P7)
//
// Buttons/links in the visitor preview behave like the exported site:
//   - internal routes (page slugs) → navigate within the preview
//   - "#anchor" / "" → stay (anchor scroll is handled by the browser)
//   - http(s) external → open in a new tab with noopener
//   - mailto: / tel: → allow (browser handles them)
//   - javascript:, data: text/html, vbscript: → BLOCKED
//
// Pure function — never touches the editor store.
// ---------------------------------------------------------------------------

export type PreviewLinkAction =
  | { kind: "internal"; route: string }
  | { kind: "external"; href: string }
  | { kind: "special"; href: string } // mailto / tel
  | { kind: "anchor"; href: string } // "#..."
  | { kind: "blocked"; href: string }
  | { kind: "noop" };

/** Detect unsafe URL schemes that must never run inside the preview. */
export function isUnsafeHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  if (value.startsWith("javascript:")) return true;
  if (value.startsWith("vbscript:")) return true;
  if (value.startsWith("data:text/html")) return true;
  return false;
}

/**
 * Classify an href for the visitor preview.
 *
 * `routes` is the project's computed page route table (routeUrl list).
 * Unknown internal-looking paths stay as-is (they may be future routes) and
 * are treated as external to avoid dead ends.
 */
export function classifyPreviewLink(
  href: unknown,
  knownRoutes: string[],
): PreviewLinkAction {
  if (typeof href !== "string" || href.trim().length === 0) {
    return { kind: "noop" };
  }

  const value = href.trim();

  if (isUnsafeHref(value)) return { kind: "blocked", href: value };

  if (value.startsWith("#")) return { kind: "anchor", href: value };

  if (/^(mailto:|tel:|sms:|ftp:|data:image\/)/i.test(value)) {
    return { kind: "special", href: value };
  }

  if (/^(https?:|www\.)/i.test(value)) {
    return { kind: "external", href: value };
  }

  // Internal path — match against the known route list (normalized).
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const path = withSlash.split(/[?#]/)[0];
  const normalized = path.replace(/\/+$/, "") || "/";
  if (knownRoutes.includes(normalized)) {
    return { kind: "internal", route: normalized };
  }

  // Unknown path: safest to treat as external navigation target (no-op in
  // preview — the exported site may host it later).
  return { kind: "external", href: value };
}

/** Normalize a href string to a safe anchor target (exported-site behavior). */
export function safeAnchorHref(href: string, knownRoutes: string[]): string {
  const action = classifyPreviewLink(href, knownRoutes);
  switch (action.kind) {
    case "internal":
      return action.route;
    case "special":
    case "anchor":
    case "external":
      return action.href;
    case "blocked":
    case "noop":
      return "#";
  }
}

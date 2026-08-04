// ---------------------------------------------------------------------------
// Section style helpers
//
// Section renderers historically hardcoded their root padding. Phase N's
// guided "Spacing" control writes `styles.padding`, so renderers now resolve
// it through these helpers — with safe fallbacks so output is unchanged when
// the style is absent (thumbnails, exports, and untouched projects).
// ---------------------------------------------------------------------------

/** Resolve `styles.padding` with a renderer-specific fallback. */
export function resolveSectionPadding(
  section: { styles?: Record<string, unknown> },
  fallback: string,
): string {
  const value = section.styles?.padding;
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

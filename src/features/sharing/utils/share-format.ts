// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — display helpers
//
// Pure formatting + clipboard helpers. Copying falls back gracefully: when
// the Clipboard API is unavailable, callers keep the link in a selectable
// input and surface the returned false so the UI can offer manual copy.
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 9, 2026" style date (UTC) for display. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * Beginner expiry label for a link: "Never", "24 hours", "7 days", "30 days",
 * "Expired", or a concrete date when the remaining time doesn't match a
 * preset (e.g. server-set expiry).
 */
export function formatExpiryLabel(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return "Never";
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return "Never";
  if (t <= now) return "Expired";
  const diffMs = t - now;
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3600000);
  const diffD = Math.round(diffMs / 86400000);
  if (diffMin <= 60) return `${Math.max(1, diffMin)} min`;
  if (diffH <= 24) return `${diffH} hours`;
  if (diffD === 1) return "24 hours";
  if (diffD <= 7) return `${diffD} days`;
  if (diffD <= 30) return `${diffD} days`;
  return formatDate(expiresAt);
}

/** "Never opened" | "Opened Aug 9" — timestamp only (privacy-conscious). */
export function formatLastOpened(lastOpenedAt: string | null | undefined): string {
  if (!lastOpenedAt) return "Never opened";
  return `Opened ${formatDate(lastOpenedAt)}`;
}

/**
 * Copy text to the clipboard. Returns false when the API is unavailable so
 * the UI can fall back to a selectable input + manual copy guidance.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to false — user can copy manually.
  }
  return false;
}

/** Longest comment preview used by the review panel (a11y/ux nicety). */
export function commentPreview(body: string, max = 200): string {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

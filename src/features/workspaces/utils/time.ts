// ---------------------------------------------------------------------------
// Phase P15 — small time helpers for activity + version history display
// ---------------------------------------------------------------------------

/** "just now", "5m ago", "3h ago", "yesterday", "2d ago", or a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export type TimeBucket = "today" | "yesterday" | "earlier";

/** Group label for a timestamp (Today / Yesterday / Earlier). */
export function timeBucket(iso: string, now = Date.now()): TimeBucket {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "earlier";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (then >= startOfToday.getTime()) return "today";
  if (then >= startOfToday.getTime() - 86_400_000) return "yesterday";
  return "earlier";
}

/** Full readable timestamp for tooltips/accessibility. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

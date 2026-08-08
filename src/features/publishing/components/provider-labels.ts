// ---------------------------------------------------------------------------
// Publishing — provider labels + duration formatting (Phase P8)
// ---------------------------------------------------------------------------

export function providerLabel(providerId: string): string {
  switch (providerId) {
    case "vercel":
      return "Vercel";
    case "mock":
      return "Demo publish";
    case "local-export":
      return "Website files";
    default:
      return providerId;
  }
}

export function providerBadgeLabel(providerId: string, realHosting: boolean): string {
  if (providerId === "mock") return "Demo";
  if (providerId === "vercel") return "Live";
  return realHosting ? "Live" : "Files";
}

/** Human duration from two ISO timestamps (or a single start). */
export function formatDuration(
  startedAt?: string,
  completedAt?: string,
): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

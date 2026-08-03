// ---------------------------------------------------------------------------
// Format project date — human-friendly relative timestamps
// ---------------------------------------------------------------------------

/**
 * Format a date string into a human-friendly relative timestamp.
 *
 * Examples:
 *   just now
 *   5 minutes ago
 *   1 hour ago
 *   yesterday
 *   12 Jul 2026
 *
 * @param dateString  ISO date string to format
 * @param reference   Reference date for testing (defaults to new Date())
 */
export function formatProjectDate(
  dateString: string,
  reference?: Date,
): string {
  const date = new Date(dateString);
  const now = reference ?? new Date();

  // Invalid date guard
  if (isNaN(date.getTime())) return "Unknown";

  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds} seconds ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 2) return "1 minute ago";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 2) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;

  // Yesterday check
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "yesterday";
  }

  // This year — show day + month
  if (date.getFullYear() === now.getFullYear()) {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }

  // Previous year — include year
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

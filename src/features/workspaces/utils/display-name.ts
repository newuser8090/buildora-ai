// ---------------------------------------------------------------------------
// Phase P15 — shared display-name heuristic
//
// Presence/activity surfaces show friendly names derived server-side from the
// member email (the auth model is email-based). Raw emails are only shown
// where the product already shows them (member management). This is the single
// client-side copy of the heuristic used by the mock server + Supabase
// provider so every surface renders the same name.
// ---------------------------------------------------------------------------

/** Friendly display name from an email (same heuristic as P14 lease holders). */
export function emailToDisplayName(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return "A teammate";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

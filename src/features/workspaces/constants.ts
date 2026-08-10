// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — constants
// ---------------------------------------------------------------------------

/** Maximum workspace name length (mirrors project name policy). */
export const MAX_WORKSPACE_NAME_LENGTH = 80;

/** Invitations expire after 14 days. */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Max pending invitations per workspace (owner-side rate boundary). */
export const MAX_PENDING_INVITATIONS_PER_WORKSPACE = 20;

/** Edit lease duration (ms) before it expires without a heartbeat. */
export const EDIT_LEASE_DURATION_MS = 60 * 1000;

/** Edit lease heartbeat interval while an editable workspace project is open. */
export const EDIT_LEASE_HEARTBEAT_MS = 20 * 1000;

/** Debounce for server-side workspace project saves (never per keystroke). */
export const WORKSPACE_SAVE_DEBOUNCE_MS = 1500;

/** Maximum serialized workspace project payload (bytes) the server accepts. */
export const WORKSPACE_PROJECT_MAX_BYTES = 8 * 1024 * 1024;

/** Local cache metadata key prefix used by the dashboard-metadata service. */
export const WORKSPACE_META_KEY = "workspace";

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

// ---------------------------------------------------------------------------
// Phase P15 — presence, activity, version history
// ---------------------------------------------------------------------------

/** Presence sessions expire after 45 s without a heartbeat (server-authoritative). */
export const PRESENCE_TTL_MS = 45 * 1000;

/** Client presence heartbeat interval while a workspace is open. */
export const PRESENCE_HEARTBEAT_MS = 10 * 1000;

/** Mock transport: poll the presence list this often (Supabase uses realtime). */
export const PRESENCE_POLL_MS = 5 * 1000;

/** Max live presence sessions per user per workspace (anti-abuse bound). */
export const MAX_PRESENCE_SESSIONS_PER_USER = 8;

/** Activity retention: keep the latest N events per workspace. */
export const ACTIVITY_RETENTION = 300;

/** Activity page size for listActivity. */
export const ACTIVITY_PAGE_SIZE = 30;

/** Version retention: keep the latest N versions per workspace project. */
export const VERSION_RETENTION = 50;

/** Manual checkpoint label bounds (plain text). */
export const MAX_VERSION_LABEL_LENGTH = 80;

/** Presence join payload bound (session id). */
export const MAX_PRESENCE_SESSION_ID_LENGTH = 200;

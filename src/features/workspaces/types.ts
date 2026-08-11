// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — core model
//
// Provider-independent types shared by the mock backend, the Supabase
// provider, the service layer, the permission helpers, and the UI. No React,
// no DOM, no Zustand.
//
// Workspace projects are SERVER-AUTHORITATIVE: the server stores a validated
// project payload plus a revision; optimistic concurrency (expectedRevision)
// prevents stale overwrites. The local IndexedDB copy is only a cache.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Roles & membership
// ---------------------------------------------------------------------------

export type WorkspaceRole = "owner" | "editor" | "viewer";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Denormalized projections (server-populated for lists). */
  memberCount?: number;
  projectCount?: number;
  /** Role of the CURRENT user. */
  memberRole?: WorkspaceRole;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  recipientEmail: string;
  role: "editor" | "viewer";
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
}

export interface WorkspaceListing {
  owned: Workspace[];
  shared: Workspace[];
}

// ---------------------------------------------------------------------------
// Workspace projects (server-authoritative)
// ---------------------------------------------------------------------------

export interface WorkspaceProjectSummary {
  projectId: string;
  workspaceId: string;
  name: string;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProjectFull extends WorkspaceProjectSummary {
  project: Project;
}

/** Optimistic-concurrency save input. */
export interface WorkspaceProjectSaveInput {
  workspaceId: string;
  projectId: string;
  project: Project;
  expectedRevision: number;
}

// ---------------------------------------------------------------------------
// Edit leases
// ---------------------------------------------------------------------------

export interface ProjectEditLease {
  projectId: string;
  workspaceId: string;
  leaseId: string;
  /** Owner of the lease (server-set from the session). */
  userId: string;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt: string;
  /** Display hint for the holder (server-populated, same-workspace members only). */
  holderEmail?: string;
}

export type LeaseAcquireResult =
  | { ok: true; lease: ProjectEditLease }
  | { ok: false; code: "LEASE_HELD"; lease: ProjectEditLease };

// ---------------------------------------------------------------------------
// Editor access context — the single runtime permission boundary
// ---------------------------------------------------------------------------

export type EditorAccessMode = "editable" | "readonly";

export type EditorReadonlyReason =
  | "viewer"
  | "being-edited"
  | "offline"
  | "unauthorized"
  | "not-loaded";

export interface EditorAccessContext {
  mode: EditorAccessMode;
  reason?: EditorReadonlyReason;
  /** Other member holding the lease ("being-edited" only). Never device ids. */
  editedBy?: string;
}

// ---------------------------------------------------------------------------
// Presence (Phase P15) — ephemeral collaboration sessions
// ---------------------------------------------------------------------------

/** Presence mode is DERIVED server-side from the edit lease — never trusted
 *  from the client (a viewer or a blocked editor is always "viewing"). */
export type WorkspacePresenceMode = "viewing" | "editing";

/** Display-safe presence projection (no device ids, tokens, or payload passthrough). */
export interface WorkspacePresence {
  workspaceId: string;
  /** Null = workspace-wide presence (e.g. dashboard). */
  projectId: string | null;
  userId: string;
  /** Client-generated; one per open tab. */
  sessionId: string;
  mode: WorkspacePresenceMode;
  joinedAt: string;
  lastSeenAt: string;
  /** Server-derived friendly name (never a raw device id). */
  displayName: string;
}

// ---------------------------------------------------------------------------
// Workspace activity (Phase P15) — durable, bounded, privacy-safe
// ---------------------------------------------------------------------------

/** Allow-listed event types. The server rejects anything else. */
export type WorkspaceActivityType =
  | "workspace.created"
  | "workspace.renamed"
  | "member.invited"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "project.created"
  | "project.moved_in"
  | "project.renamed"
  | "project.saved"
  | "project.duplicated"
  | "project.deleted"
  | "project.version_created"
  | "project.version_restored"
  | "publish.completed"
  | "publish.rollback"
  | "share.created"
  | "share.revoked"
  | "domain.attached"
  | "domain.removed";

/** Metadata values are scalars only (allow-listed per type — never free JSON). */
export type WorkspaceActivityMetadata = Record<string, string | number | boolean>;

export interface WorkspaceActivityEvent {
  id: string;
  workspaceId: string;
  projectId: string | null;
  /** SERVER-DERIVED from the session — a client-supplied actor is ignored. */
  actorUserId: string;
  type: WorkspaceActivityType;
  createdAt: string;
  metadata: WorkspaceActivityMetadata;
  /** Server-populated display name (lists only) — never client-supplied. */
  actorName?: string;
}

/** Activity list filters (UI-level; the server allow-lists types regardless). */
export type WorkspaceActivityFilter =
  | "all"
  | "projects"
  | "members"
  | "publishing"
  | "sharing";

/** Cursor for (createdAt DESC, id DESC) pagination. */
export interface ActivityCursor {
  ts: string;
  id: string;
}

// ---------------------------------------------------------------------------
// Project version history (Phase P15) — server-backed snapshots
// ---------------------------------------------------------------------------

export type ProjectVersionReason =
  | "autosave"
  | "publish"
  | "checkpoint"
  | "pre-restore"
  | "restore";

/** Metadata-only list entry — snapshots are fetched lazily on preview. */
export interface ProjectVersionMeta {
  id: string;
  workspaceId: string;
  projectId: string;
  /** Project revision captured at version time (before it incremented). */
  revision: number;
  createdBy: string;
  /** Server-populated display name (lists only) — never client-supplied. */
  createdByName?: string;
  createdAt: string;
  reason: ProjectVersionReason;
  label?: string;
  contentHash: string;
}

export interface ProjectVersionFull extends ProjectVersionMeta {
  /** Validated canonical Project payload (no collaboration metadata). */
  project: Project;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type WorkspaceErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "PERMISSION_DENIED"
  | "OFFLINE"
  | "NETWORK_FAILED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INVALID_NAME"
  | "INVALID_EMAIL"
  | "INVALID_ROLE"
  | "INVALID_INPUT"
  | "ALREADY_MEMBER"
  | "INVITE_INVALID"
  | "INVITE_EXPIRED"
  | "STALE_REVISION"
  | "LEASE_HELD"
  | "LEASE_INVALID"
  | "LOCKED"
  | "PROJECT_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "PAYLOAD_INVALID"
  | "LAST_OWNER"
  | "NOT_CONFIGURED"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN";

export interface WorkspaceError {
  code: WorkspaceErrorCode;
  /** User-safe message — never SQL, tokens, table names, or stack traces. */
  message: string;
  /** Internal diagnostic detail (never shown to beginners). */
  cause?: string;
  /** True when retrying later is likely to succeed. */
  retryable: boolean;
}

/** Envelope for provider/service results. */
export type WorkspaceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorkspaceError };

// ---------------------------------------------------------------------------
// Wire envelope (mock API + provider parity)
// ---------------------------------------------------------------------------

export interface WorkspaceApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Local cache metadata (device-side; NEVER an authorization source)
// ---------------------------------------------------------------------------

export interface WorkspaceProjectCacheMeta {
  workspaceId: string;
  /** User id that opened/cached this project on this device. */
  userId: string;
  /** Server revision at last successful fetch/save (for offline read labels). */
  serverRevision: number;
  serverUpdatedAt: string;
}

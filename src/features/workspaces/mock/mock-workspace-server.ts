// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — mock workspace
// backend (DEV/TEST ONLY)
//
// In-memory stand-in for the Supabase workspace tables, exposed through
// Next.js API routes (/api/workspaces/...) so the full feature (workspaces,
// membership, invitations, workspace projects, edit leases) is exercisable
// end-to-end without credentials. State lives on the dev-server process
// (globalThis, same pattern as P6/P12), so two browser contexts hitting the
// same dev server share one "cloud" — that is what makes cross-device E2E
// possible.
//
// Security posture mirrors the real backend (RLS + SECURITY DEFINER RPCs):
//   - bearer sessions shared with the Phase P6 mock cloud state
//   - membership-only reads; owner-only management; editor/viewer gating
//   - recipient-scoped invitations (acceptance requires matching email)
//   - role-scoped lease acquisition; server-issued lease ids
//   - optimistic concurrency (expectedRevision) — stale writes rejected
//   - no cross-workspace enumeration; owner invariants enforced
// ---------------------------------------------------------------------------

import { randomBytes, randomUUID } from "node:crypto";
import { getMockCloudState } from "@/features/cloud-sync/mock/mock-cloud-server";
import { stableHash } from "@/features/cloud-sync/hash";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_RETENTION,
  EDIT_LEASE_DURATION_MS,
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS_PER_WORKSPACE,
  MAX_PRESENCE_SESSIONS_PER_USER,
  MAX_VERSION_LABEL_LENGTH,
  MAX_WORKSPACE_NAME_LENGTH,
  PRESENCE_TTL_MS,
  VERSION_RETENTION,
  WORKSPACE_PROJECT_MAX_BYTES,
} from "../constants";
import type {
  ActivityCursor,
  LeaseAcquireResult,
  ProjectEditLease,
  ProjectVersionFull,
  ProjectVersionMeta,
  ProjectVersionReason,
  Workspace,
  WorkspaceActivityEvent,
  WorkspaceActivityMetadata,
  WorkspaceActivityType,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspacePresence,
  WorkspaceProjectFull,
  WorkspaceProjectSummary,
  WorkspaceRole,
} from "../types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface MockWorkspaceRecord extends Workspace {
  members: Map<string, WorkspaceRole>; // userId -> role (owner included)
}

interface MockWorkspaceProject {
  workspaceId: string;
  projectId: string;
  name: string;
  payload: string; // serialized validated project JSON
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Phase P15: presence (ephemeral) ----

interface MockPresenceSession {
  sessionId: string;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  joinedAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

// ---- Phase P16: collaboration rooms (in-memory realtime relay) ----
//
// One room per workspace project. Rooms carry the update log between the
// durable checkpoint frontier and the live seq; the durable base is always the
// current workspace project payload (the save path advances both). A client
// that polls behind the pruned frontier is told to rebase from the base.

interface MockCollabUpdate {
  seq: number;
  data: string; // base64-encoded Yjs update
  actorClientId: string;
  at: string;
}

interface MockCollabRoom {
  workspaceId: string;
  projectId: string;
  seq: number;
  checkpointSeq: number;
  updates: MockCollabUpdate[];
  /** Maintenance lock holder (version restore / import), userId or null. */
  lockHolder: string | null;
  /**
   * Canonical shared Yjs state (base64) — set by the FIRST joiner's seed and
   * refreshed at every durable checkpoint. Later joiners apply it via
   * applyUpdate so every client shares identical structs (no duplication).
   */
  canonicalState: string | null;
}

// ---- Phase P15: project versions (durable, bounded) ----

interface MockProjectVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  /** Project revision AFTER the change this snapshot represents. */
  revision: number;
  createdBy: string;
  createdAt: string;
  reason: ProjectVersionReason;
  label?: string;
  contentHash: string;
  snapshot: string; // serialized validated project JSON
}

export interface MockWorkspaceState {
  workspaces: Map<string, MockWorkspaceRecord>;
  invitations: Map<string, WorkspaceInvitation>;
  projects: Map<string, MockWorkspaceProject>; // `${workspaceId}:${projectId}`
  leases: Map<string, ProjectEditLease>; // `${workspaceId}:${projectId}` -> lease
  inviteAttempts: Map<string, number[]>; // workspaceId -> timestamps
  presence: Map<string, MockPresenceSession>; // sessionId -> session (P15)
  activity: Map<string, WorkspaceActivityEvent[]>; // workspaceId -> events, newest first (P15)
  versions: Map<string, MockProjectVersion[]>; // `${ws}:${pid}` -> versions, newest first (P15)
  collabRooms: Map<string, MockCollabRoom>; // `${ws}:${pid}` -> room (P16)
  collabSendAttempts: Map<string, number[]>; // room key -> send timestamps (P17 rate limit)
}

export function createMockWorkspaceState(): MockWorkspaceState {
  return {
    workspaces: new Map(),
    invitations: new Map(),
    projects: new Map(),
    leases: new Map(),
    inviteAttempts: new Map(),
    presence: new Map(),
    activity: new Map(),
    versions: new Map(),
    collabRooms: new Map(),
    collabSendAttempts: new Map(),
  };
}

// Bumped to v2 when the state SHAPE changed (Phase P17 added
// collabSendAttempts): a dev server that hot-recompiled a newer module over an
// older globalThis state would otherwise hand the new handlers a stale shape
// (e.g. `collabSendAttempts` undefined) and every collab send would crash.
const MOCK_WORKSPACE_GLOBAL_KEY = "buildora.mockWorkspaceState.v2";

export function getMockWorkspaceState(): MockWorkspaceState {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[MOCK_WORKSPACE_GLOBAL_KEY];
  if (existing) return existing as MockWorkspaceState;
  const fresh = createMockWorkspaceState();
  g[MOCK_WORKSPACE_GLOBAL_KEY] = fresh;
  return fresh;
}

export function resetMockWorkspaceState(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g[MOCK_WORKSPACE_GLOBAL_KEY] = createMockWorkspaceState();
}

// ---------------------------------------------------------------------------
// Errors & helpers
// ---------------------------------------------------------------------------

export class MockWorkspaceError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Resolve the authenticated user from a bearer token (P6 session store). */
function requireUser(token: string | null): { id: string; email: string } {
  if (!token) {
    throw new MockWorkspaceError(401, "AUTH_REQUIRED", "Sign in to continue.");
  }
  const state = getMockCloudState();
  const userId = state.sessions.get(token);
  if (!userId) {
    throw new MockWorkspaceError(401, "SESSION_EXPIRED", "Your session ended. Sign in again.");
  }
  const user = [...state.users.values()].find((u) => u.id === userId);
  if (!user) {
    throw new MockWorkspaceError(401, "SESSION_EXPIRED", "Your session ended. Sign in again.");
  }
  return { id: user.id, email: user.email };
}

function requireWorkspace(
  state: MockWorkspaceState,
  workspaceId: string,
): MockWorkspaceRecord {
  const workspace = state.workspaces.get(workspaceId);
  if (!workspace) {
    throw new MockWorkspaceError(404, "NOT_FOUND", "That workspace could not be found.");
  }
  return workspace;
}

/** Membership check (owner lives on the workspace record). */
function requireMember(
  state: MockWorkspaceState,
  user: { id: string },
  workspaceId: string,
): MockWorkspaceRecord {
  const workspace = requireWorkspace(state, workspaceId);
  if (workspace.ownerId !== user.id && !workspace.members.has(user.id)) {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "You don't have access to that workspace.");
  }
  return workspace;
}

/** Owner-only guard. */
function requireOwner(
  state: MockWorkspaceState,
  user: { id: string },
  workspaceId: string,
): MockWorkspaceRecord {
  const workspace = requireWorkspace(state, workspaceId);
  if (workspace.ownerId !== user.id) {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "Only the owner can do that.");
  }
  return workspace;
}

/** Editor-or-owner guard (mutation / lease operations). */
function requireEditor(
  state: MockWorkspaceState,
  user: { id: string },
  workspaceId: string,
): MockWorkspaceRecord {
  const workspace = requireMember(state, user, workspaceId);
  const role = workspace.ownerId === user.id ? "owner" : workspace.members.get(user.id);
  if (role !== "owner" && role !== "editor") {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "You need edit permission to do that.");
  }
  return workspace;
}

function rateLimited(
  bucket: Map<string, number[]>,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const timestamps = (bucket.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= max) {
    bucket.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  bucket.set(key, timestamps);
  return false;
}

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isValidId(value: string, max = 200): boolean {
  return value.length > 0 && value.length <= max;
}

function userEmail(state: MockWorkspaceState, userId: string): string {
  const cloud = getMockCloudState();
  const user = [...cloud.users.values()].find((u) => u.id === userId);
  return user?.email ?? "";
}

function roleOf(workspace: MockWorkspaceRecord, userId: string): WorkspaceRole {
  if (workspace.ownerId === userId) return "owner";
  return workspace.members.get(userId) ?? "viewer";
}

function toWorkspaceView(workspace: MockWorkspaceRecord, viewerId: string): Workspace {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerId: workspace.ownerId,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    memberCount: workspace.members.size + (workspace.members.has(workspace.ownerId) ? 0 : 1),
    projectCount: projectCountForWorkspace(workspace.id),
    memberRole: roleOf(workspace, viewerId),
  };
}

function projectCountForWorkspace(workspaceId: string): number {
  const state = getMockWorkspaceState();
  let count = 0;
  for (const project of state.projects.values()) {
    if (project.workspaceId === workspaceId) count += 1;
  }
  return count;
}

/** Attach the holder's email for same-workspace display (never device ids). */
function withHolderEmail(
  state: MockWorkspaceState,
  lease: ProjectEditLease,
): ProjectEditLease {
  return { ...lease, holderEmail: userEmail(state, lease.userId) };
}

function toProjectSummary(project: MockWorkspaceProject): WorkspaceProjectSummary {
  return {
    projectId: project.projectId,
    workspaceId: project.workspaceId,
    name: project.name,
    revision: project.revision,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function projectKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function requireProject(
  state: MockWorkspaceState,
  workspaceId: string,
  projectId: string,
): MockWorkspaceProject {
  const project = state.projects.get(projectKey(workspaceId, projectId));
  if (!project) {
    throw new MockWorkspaceError(404, "PROJECT_NOT_FOUND", "That project could not be found.");
  }
  return project;
}

// ---------------------------------------------------------------------------
// Phase P15 — activity (durable, bounded, actor server-derived)
// ---------------------------------------------------------------------------

/** Allow-listed event types — the server rejects anything else. */
const ACTIVITY_TYPES: ReadonlySet<string> = new Set<WorkspaceActivityType>([
  "workspace.created",
  "workspace.renamed",
  "member.invited",
  "member.joined",
  "member.role_changed",
  "member.removed",
  "project.created",
  "project.moved_in",
  "project.renamed",
  "project.saved",
  "project.duplicated",
  "project.deleted",
  "project.version_created",
  "project.version_restored",
  "publish.completed",
  "publish.rollback",
  "share.created",
  "share.revoked",
  "domain.attached",
  "domain.removed",
]);

/** Per-type metadata key allow-lists (scalar values only, never free JSON). */
const ACTIVITY_METADATA_KEYS: Record<string, ReadonlySet<string>> = {
  "workspace.created": new Set(),
  "workspace.renamed": new Set(["to"]),
  "member.invited": new Set(["email", "role"]),
  "member.joined": new Set(["role"]),
  "member.role_changed": new Set(["member", "to"]),
  "member.removed": new Set(["member"]),
  "project.created": new Set(["project"]),
  "project.moved_in": new Set(["project"]),
  "project.renamed": new Set(["project", "to"]),
  "project.saved": new Set(["revision"]),
  "project.duplicated": new Set(["project", "from"]),
  "project.deleted": new Set(["project"]),
  "project.version_created": new Set(["version", "label"]),
  "project.version_restored": new Set(["from", "to"]),
  "publish.completed": new Set(["provider", "project"]),
  "publish.rollback": new Set(["provider", "project"]),
  "share.created": new Set(["project"]),
  "share.revoked": new Set(["project"]),
  "domain.attached": new Set(["domain", "project"]),
  "domain.removed": new Set(["domain", "project"]),
};

const MAX_ACTIVITY_METADATA_STRING = 200;
const MAX_ACTIVITY_METADATA_ENTRIES = 4;

/** Validate metadata against the type's allow-list; returns a clean copy. */
function sanitizeActivityMetadata(
  type: string,
  raw: unknown,
): WorkspaceActivityMetadata {
  const allowed = ACTIVITY_METADATA_KEYS[type] ?? new Set<string>();
  const metadata: WorkspaceActivityMetadata = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return metadata;
  let entries = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (entries >= MAX_ACTIVITY_METADATA_ENTRIES) break;
    if (!allowed.has(key)) continue;
    if (typeof value === "string") {
      if (value.length > MAX_ACTIVITY_METADATA_STRING) continue;
      metadata[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      metadata[key] = value;
    } else if (typeof value === "boolean") {
      metadata[key] = value;
    }
    entries += 1;
  }
  return metadata;
}

/** Insert an event (newest first) and prune to the retention bound. */
function pushActivity(
  state: MockWorkspaceState,
  actorUserId: string,
  workspaceId: string,
  projectId: string | null,
  type: WorkspaceActivityType,
  metadata: WorkspaceActivityMetadata,
): WorkspaceActivityEvent {
  const event: WorkspaceActivityEvent = {
    id: `wsact-${randomUUID()}`,
    workspaceId,
    projectId,
    actorUserId,
    type,
    createdAt: nowIso(),
    metadata,
  };
  const list = state.activity.get(workspaceId) ?? [];
  list.unshift(event);
  if (list.length > ACTIVITY_RETENTION) list.length = ACTIVITY_RETENTION;
  state.activity.set(workspaceId, list);
  return event;
}

function displayNameOf(state: MockWorkspaceState, userId: string): string {
  return emailToDisplayName(userEmail(state, userId));
}

/** Friendly display name from an email (same heuristic as P14 lease holders). */
function emailToDisplayName(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return "A teammate";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Phase P15 — presence (ephemeral, TTL-based, membership-scoped)
// ---------------------------------------------------------------------------

function pruneExpiredPresence(state: MockWorkspaceState, now = Date.now()): void {
  for (const [sessionId, session] of [...state.presence]) {
    if (new Date(session.expiresAt).getTime() <= now) {
      state.presence.delete(sessionId);
    }
  }
}

function presenceModeOf(
  state: MockWorkspaceState,
  session: MockPresenceSession,
): WorkspacePresence["mode"] {
  // Phase P16 — SIMULTANEOUS EDITING: mode is DERIVED from the member's ROLE,
  // never self-claimed. The P14 exclusive edit lease no longer gates ordinary
  // editing (it is now the owner-only maintenance lock for restore/import), so
  // a lease can no longer decide "editing". Editors/owners with an active
  // presence session on the project are "editing"; viewers are "viewing".
  if (!session.projectId) return "viewing";
  const workspace = state.workspaces.get(session.workspaceId);
  if (!workspace) return "viewing";
  const role = roleOf(workspace, session.userId);
  if (role === "owner" || role === "editor") return "editing";
  return "viewing";
}

export function handleJoinPresence(
  state: MockWorkspaceState,
  token: string | null,
  input: { workspaceId?: unknown; projectId?: unknown; sessionId?: unknown },
): void {
  const user = requireUser(token);
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : "";
  // Throws for non-members — presence is workspace-scoped (never global).
  requireMember(state, user, workspaceId);
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (!isValidId(sessionId, 200)) {
    throw new MockWorkspaceError(400, "INVALID_INPUT", "That presence session isn't valid.");
  }

  let projectId: string | null = null;
  if (input.projectId !== undefined && input.projectId !== null && input.projectId !== "") {
    projectId = typeof input.projectId === "string" ? input.projectId : "";
    if (!isValidId(projectId)) {
      throw new MockWorkspaceError(400, "INVALID_INPUT", "That project isn't valid.");
    }
    // Presence for a project requires the project to exist here.
    requireProject(state, workspaceId, projectId);
  }

  const existing = state.presence.get(sessionId);
  if (existing && (existing.userId !== user.id || existing.workspaceId !== workspaceId)) {
    // Session-id forgery — never let one session hijack another user's slot.
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "That presence session isn't yours.");
  }

  const now = Date.now();
  if (!existing) {
    const mine = [...state.presence.values()].filter(
      (s) => s.userId === user.id && s.workspaceId === workspaceId,
    ).length;
    if (mine >= MAX_PRESENCE_SESSIONS_PER_USER) {
      throw new MockWorkspaceError(429, "RATE_LIMITED", "Too many open sessions for this workspace.");
    }
  }

  state.presence.set(sessionId, {
    sessionId,
    workspaceId,
    projectId,
    userId: user.id,
    joinedAt: existing?.joinedAt ?? nowIso(),
    lastSeenAt: nowIso(),
    expiresAt: new Date(now + PRESENCE_TTL_MS).toISOString(),
  });
}

export function handleHeartbeatPresence(
  state: MockWorkspaceState,
  token: string | null,
  sessionId: string,
): void {
  const user = requireUser(token);
  const session = state.presence.get(sessionId);
  if (!session || session.userId !== user.id) {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "That presence session ended.");
  }
  session.lastSeenAt = nowIso();
  session.expiresAt = new Date(Date.now() + PRESENCE_TTL_MS).toISOString();
}

export function handleLeavePresence(
  state: MockWorkspaceState,
  token: string | null,
  sessionId: string,
): void {
  const user = requireUser(token);
  const session = state.presence.get(sessionId);
  if (!session) return; // idempotent
  if (session.userId !== user.id) {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "That presence session isn't yours.");
  }
  state.presence.delete(sessionId);
}

export function handleListWorkspacePresence(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId?: string | null,
): WorkspacePresence[] {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  pruneExpiredPresence(state);
  const sessions = [...state.presence.values()].filter(
    (s) =>
      s.workspaceId === workspaceId &&
      (projectId ? s.projectId === projectId : true),
  );
  // UI dedupes by user; the raw list keeps every tab's session.
  sessions.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  return sessions.map((s) => ({
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userId: s.userId,
    sessionId: s.sessionId,
    mode: presenceModeOf(state, s),
    joinedAt: s.joinedAt,
    lastSeenAt: s.lastSeenAt,
    displayName: displayNameOf(state, s.userId),
  }));
}

/** Remove every presence session a user holds in a workspace (access loss). */
export function purgeUserPresence(
  state: MockWorkspaceState,
  workspaceId: string,
  userId: string,
): void {
  for (const [sessionId, session] of [...state.presence]) {
    if (session.workspaceId === workspaceId && session.userId === userId) {
      state.presence.delete(sessionId);
    }
  }
}

/** Remove every presence session tied to a project (project deletion). */
export function purgeProjectPresence(
  state: MockWorkspaceState,
  workspaceId: string,
  projectId: string,
): void {
  for (const [sessionId, session] of [...state.presence]) {
    if (session.workspaceId === workspaceId && session.projectId === projectId) {
      state.presence.delete(sessionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase P15 — project version history (durable, bounded, lazy snapshots)
// ---------------------------------------------------------------------------

function versionKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function contentHashOf(snapshotPayload: string): string {
  return stableHash(JSON.parse(snapshotPayload));
}

function toVersionMeta(
  version: MockProjectVersion,
  state: MockWorkspaceState,
): ProjectVersionMeta {
  return {
    id: version.id,
    workspaceId: version.workspaceId,
    projectId: version.projectId,
    revision: version.revision,
    createdBy: version.createdBy,
    createdByName: displayNameOf(state, version.createdBy),
    createdAt: version.createdAt,
    reason: version.reason,
    label: version.label,
    contentHash: version.contentHash,
  };
}

function requireVersion(
  state: MockWorkspaceState,
  workspaceId: string,
  projectId: string,
  versionId: string,
): MockProjectVersion {
  const list = state.versions.get(versionKey(workspaceId, projectId)) ?? [];
  const version = list.find((v) => v.id === versionId);
  if (!version) {
    throw new MockWorkspaceError(404, "VERSION_NOT_FOUND", "That version could not be found.");
  }
  return version;
}

/**
 * Insert a version (newest first), prune to retention. Autosave versions are
 * deduped by content hash against the latest version; explicit actions
 * (checkpoint/publish/restore/pre-restore) always record.
 */
function pushVersion(
  state: MockWorkspaceState,
  input: {
    workspaceId: string;
    projectId: string;
    revision: number;
    createdBy: string;
    reason: ProjectVersionReason;
    label?: string;
    snapshot: string;
  },
): ProjectVersionMeta | null {
  const contentHash = contentHashOf(input.snapshot);
  const list = state.versions.get(versionKey(input.workspaceId, input.projectId)) ?? [];
  if (input.reason === "autosave") {
    const latest = list[0];
    if (latest && latest.contentHash === contentHash) return null;
  }
  const version: MockProjectVersion = {
    id: `wsv-${randomUUID()}`,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    revision: input.revision,
    createdBy: input.createdBy,
    createdAt: nowIso(),
    reason: input.reason,
    label: input.label,
    contentHash,
    snapshot: input.snapshot,
  };
  list.unshift(version);
  if (list.length > VERSION_RETENTION) list.length = VERSION_RETENTION;
  state.versions.set(versionKey(input.workspaceId, input.projectId), list);
  return toVersionMeta(version, state);
}

export function handleListProjectVersions(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): ProjectVersionMeta[] {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  requireProject(state, workspaceId, projectId);
  const list = state.versions.get(versionKey(workspaceId, projectId)) ?? [];
  return list.map((v) => toVersionMeta(v, state));
}

export function handleFetchProjectVersion(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  versionId: string,
): ProjectVersionFull {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  requireProject(state, workspaceId, projectId);
  const version = requireVersion(state, workspaceId, projectId, versionId);
  return {
    ...toVersionMeta(version, state),
    project: JSON.parse(version.snapshot) as ProjectVersionFull["project"],
  };
}

export function handleCreateManualVersion(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  label?: unknown,
): ProjectVersionMeta {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  const project = requireProject(state, workspaceId, projectId);
  // Manual checkpoints require the current session to be editable (lease held).
  const lease = state.leases.get(projectKey(workspaceId, projectId));
  if (!lease || lease.userId !== user.id) {
    throw new MockWorkspaceError(
      403,
      "LEASE_HELD",
      "Someone else is editing this project — you can't save a version right now.",
    );
  }
  let cleanLabel: string | undefined;
  if (label !== undefined && label !== null && label !== "") {
    cleanLabel = typeof label === "string" ? label.trim().slice(0, MAX_VERSION_LABEL_LENGTH) : "";
    if (!cleanLabel) {
      throw new MockWorkspaceError(400, "INVALID_INPUT", "Give your version a label.");
    }
  }
  const version = pushVersion(state, {
    workspaceId,
    projectId,
    revision: project.revision,
    createdBy: user.id,
    reason: "checkpoint",
    label: cleanLabel,
    snapshot: project.payload,
  });
  if (!version) {
    // Identical content: still record the explicit checkpoint intent.
    throw new MockWorkspaceError(409, "INVALID_INPUT", "Nothing changed since the last version.");
  }
  pushActivity(state, user.id, workspaceId, projectId, "project.version_created", {
    version: version.id,
    ...(cleanLabel ? { label: cleanLabel } : {}),
  });
  return version;
}

export function handleRestoreProjectVersion(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  versionId: string,
  expectedRevision: unknown,
): { revision: number } {
  const user = requireUser(token);
  requireOwner(state, user, workspaceId); // Owner-only restore (documented).
  const project = requireProject(state, workspaceId, projectId);

  // Optimistic concurrency: never silently overwrite a newer server revision.
  const expected = typeof expectedRevision === "number" ? expectedRevision : -1;
  if (project.revision !== expected) {
    throw new MockWorkspaceError(409, "STALE_REVISION", "This project changed while you were reviewing history.");
  }

  const version = requireVersion(state, workspaceId, projectId, versionId);

  // Safety version of the CURRENT state (preserves what restore overwrites).
  if (contentHashOf(project.payload) !== version.contentHash) {
    pushVersion(state, {
      workspaceId,
      projectId,
      revision: project.revision,
      createdBy: user.id,
      reason: "pre-restore",
      label: `Before restoring version ${version.revision}`,
      snapshot: project.payload,
    });
  }

  // Apply the snapshot as a NEW revision; old versions are never deleted.
  project.payload = version.snapshot;
  project.name = JSON.parse(version.snapshot).name ?? project.name;
  project.revision += 1;
  project.updatedAt = nowIso();

  // Phase P16 — restore replaces the whole project: reset the collaboration
  // room so every connected client rebases from the restored durable base
  // (never a silent partial-merge of stale updates). The canonical state is
  // cleared too — otherwise a late joiner would apply the pre-restore structs.
  const room = getCollabRoom(state, workspaceId, projectId);
  room.seq += 1;
  room.checkpointSeq = room.seq;
  room.updates = [];
  room.canonicalState = null;

  pushVersion(state, {
    workspaceId,
    projectId,
    revision: project.revision,
    createdBy: user.id,
    reason: "restore",
    label: `Restored from version ${version.revision}`,
    snapshot: version.snapshot,
  });
  pushActivity(state, user.id, workspaceId, projectId, "project.version_restored", {
    from: version.id,
    to: project.revision,
  });
  return { revision: project.revision };
}

export function handleCopyProjectFromVersion(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  versionId: string,
  input: { newProjectId?: unknown; name?: unknown },
): WorkspaceProjectSummary {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  requireProject(state, workspaceId, projectId);
  const version = requireVersion(state, workspaceId, projectId, versionId);

  const newProjectId = typeof input.newProjectId === "string" ? input.newProjectId : "";
  if (!isValidId(newProjectId)) {
    throw new MockWorkspaceError(400, "INVALID_INPUT", "That project isn't valid.");
  }
  if (state.projects.has(projectKey(workspaceId, newProjectId))) {
    throw new MockWorkspaceError(409, "INVALID_INPUT", "That project already exists in this workspace.");
  }
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 80)
      : `Copy of ${version.revision}`;
  const nameValidation = validateProjectName(name);
  if (!nameValidation.valid) {
    throw new MockWorkspaceError(400, "INVALID_INPUT", nameValidation.error ?? "That name isn't valid.");
  }

  const now = nowIso();
  const project: MockWorkspaceProject = {
    workspaceId,
    projectId: newProjectId,
    name,
    payload: version.snapshot, // validated when the version was created
    revision: 1,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  state.projects.set(projectKey(workspaceId, newProjectId), project);
  pushActivity(state, user.id, workspaceId, newProjectId, "project.created", {
    project: name,
  });
  return toProjectSummary(project);
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export function handleListWorkspaces(
  state: MockWorkspaceState,
  token: string | null,
): { owned: Workspace[]; shared: Workspace[] } {
  const user = requireUser(token);
  const owned: Workspace[] = [];
  const shared: Workspace[] = [];
  for (const workspace of state.workspaces.values()) {
    if (workspace.ownerId === user.id) {
      owned.push(toWorkspaceView(workspace, user.id));
    } else if (workspace.members.has(user.id)) {
      shared.push(toWorkspaceView(workspace, user.id));
    }
  }
  return { owned, shared };
}

export function handleCreateWorkspace(
  state: MockWorkspaceState,
  token: string | null,
  input: { name?: unknown },
): Workspace {
  const user = requireUser(token);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new MockWorkspaceError(400, "INVALID_NAME", "Give your workspace a name.");
  }
  const now = nowIso();
  const record: MockWorkspaceRecord = {
    id: `ws-${randomUUID()}`,
    name,
    ownerId: user.id,
    createdAt: now,
    updatedAt: now,
    members: new Map([[user.id, "owner"]]),
  };
  state.workspaces.set(record.id, record);
  pushActivity(state, user.id, record.id, null, "workspace.created", {});
  return toWorkspaceView(record, user.id);
}

export function handleUpdateWorkspace(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  patch: { name?: unknown },
): Workspace {
  const user = requireUser(token);
  const workspace = requireOwner(state, user, workspaceId);
  const name = typeof patch.name === "string" ? patch.name.trim() : "";
  if (!name || name.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new MockWorkspaceError(400, "INVALID_NAME", "Give your workspace a name.");
  }
  workspace.name = name;
  workspace.updatedAt = nowIso();
  pushActivity(state, user.id, workspaceId, null, "workspace.renamed", { to: name });
  return toWorkspaceView(workspace, user.id);
}

export function handleDeleteWorkspace(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
): void {
  const user = requireUser(token);
  requireOwner(state, user, workspaceId);
  state.workspaces.delete(workspaceId);
  // Cascade: projects, invitations, leases, presence, activity, versions.
  for (const key of [...state.projects.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) state.projects.delete(key);
  }
  for (const lease of [...state.leases.values()]) {
    if (lease.workspaceId === workspaceId) {
      state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
    }
  }
  for (const [id, invitation] of [...state.invitations]) {
    if (invitation.workspaceId === workspaceId) state.invitations.delete(id);
  }
  for (const [sessionId, session] of [...state.presence]) {
    if (session.workspaceId === workspaceId) state.presence.delete(sessionId);
  }
  for (const key of [...state.versions.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) state.versions.delete(key);
  }
  state.activity.delete(workspaceId);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function handleListMembers(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
): WorkspaceMember[] {
  const user = requireUser(token);
  const workspace = requireOwner(state, user, workspaceId);
  const members: WorkspaceMember[] = [];
  for (const [userId, role] of workspace.members) {
    if (userId === workspace.ownerId) continue;
    members.push({
      workspaceId,
      userId,
      email: userEmail(state, userId),
      role,
      joinedAt: "",
    });
  }
  members.sort((a, b) => a.email.localeCompare(b.email));
  return members;
}

export function handleChangeMemberRole(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  memberUserId: string,
  role: unknown,
): void {
  const user = requireUser(token);
  const workspace = requireOwner(state, user, workspaceId);
  if (memberUserId === workspace.ownerId) {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "The owner's role can't be changed.");
  }
  if (role !== "editor" && role !== "viewer") {
    throw new MockWorkspaceError(400, "INVALID_ROLE", "Please choose a valid role.");
  }
  if (!workspace.members.has(memberUserId)) {
    throw new MockWorkspaceError(404, "NOT_FOUND", "That member could not be found.");
  }
  workspace.members.set(memberUserId, role as "editor" | "viewer");
  workspace.updatedAt = nowIso();
  // A role change to viewer invalidates any lease the member holds and ends
  // their live editing presence.
  if (role === "viewer") {
    for (const lease of [...state.leases.values()]) {
      if (lease.workspaceId === workspaceId && lease.userId === memberUserId) {
        state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
      }
    }
    purgeUserPresence(state, workspaceId, memberUserId);
  }
  pushActivity(state, user.id, workspaceId, null, "member.role_changed", {
    member: displayNameOf(state, memberUserId),
    to: role as string,
  });
}

export function handleRemoveMember(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  memberUserId: string,
): void {
  const user = requireUser(token);
  const workspace = requireOwner(state, user, workspaceId);
  if (memberUserId === workspace.ownerId) {
    throw new MockWorkspaceError(403, "LAST_OWNER", "A workspace must always have an owner.");
  }
  workspace.members.delete(memberUserId);
  workspace.updatedAt = nowIso();
  // Immediate access loss: drop any lease the removed member held and end
  // their presence sessions (no streaming private events after removal).
  for (const lease of [...state.leases.values()]) {
    if (lease.workspaceId === workspaceId && lease.userId === memberUserId) {
      state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
    }
  }
  purgeUserPresence(state, workspaceId, memberUserId);
  // Void their pending invitations.
  for (const invitation of [...state.invitations.values()]) {
    if (
      invitation.workspaceId === workspaceId &&
      invitation.status === "pending" &&
      invitation.recipientEmail === userEmail(state, memberUserId)
    ) {
      invitation.status = "revoked";
    }
  }
  pushActivity(state, user.id, workspaceId, null, "member.removed", {
    member: displayNameOf(state, memberUserId),
  });
}

export function handleLeaveWorkspace(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
): void {
  const user = requireUser(token);
  const workspace = requireMember(state, user, workspaceId);
  if (workspace.ownerId === user.id) {
    throw new MockWorkspaceError(403, "PERMISSION_DENIED", "Owners can't leave — delete the workspace instead.");
  }
  workspace.members.delete(user.id);
  for (const lease of [...state.leases.values()]) {
    if (lease.workspaceId === workspaceId && lease.userId === user.id) {
      state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
    }
  }
  purgeUserPresence(state, workspaceId, user.id);
  pushActivity(state, user.id, workspaceId, null, "member.removed", {
    member: displayNameOf(state, user.id),
  });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export function handleInviteMember(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  input: { email?: unknown; role?: unknown },
): WorkspaceInvitation {
  const user = requireUser(token);
  const workspace = requireOwner(state, user, workspaceId);
  if (rateLimited(state.inviteAttempts, workspaceId, 40, 60_000)) {
    throw new MockWorkspaceError(429, "RATE_LIMITED", "Too many invitations. Try again shortly.");
  }
  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  if (!isValidEmail(email)) {
    throw new MockWorkspaceError(400, "INVALID_EMAIL", "Please enter a valid email address.");
  }
  if (email === user.email.toLowerCase()) {
    throw new MockWorkspaceError(400, "INVALID_EMAIL", "You can't invite yourself.");
  }
  const role: "editor" | "viewer" = input.role === "editor" ? "editor" : "viewer";
  if (role !== "editor" && role !== "viewer") {
    throw new MockWorkspaceError(400, "INVALID_ROLE", "Please choose a valid role.");
  }

  // Already a member?
  for (const [userId] of workspace.members) {
    if (userEmail(state, userId).toLowerCase() === email) {
      throw new MockWorkspaceError(409, "ALREADY_MEMBER", "That person is already in this workspace.");
    }
  }

  // Replace any prior pending invitation for the same workspace + email.
  for (const invitation of [...state.invitations.values()]) {
    if (
      invitation.workspaceId === workspaceId &&
      invitation.status === "pending" &&
      invitation.recipientEmail === email
    ) {
      invitation.status = "revoked";
    }
  }

  // Bound pending invitations.
  const pending = [...state.invitations.values()].filter(
    (i) => i.workspaceId === workspaceId && i.status === "pending",
  ).length;
  if (pending >= MAX_PENDING_INVITATIONS_PER_WORKSPACE) {
    throw new MockWorkspaceError(429, "RATE_LIMITED", "This workspace has too many pending invitations.");
  }

  const now = new Date();
  const invitation: WorkspaceInvitation = {
    id: `wsinv-${randomUUID()}`,
    workspaceId,
    workspaceName: workspace.name,
    recipientEmail: email,
    role,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS).toISOString(),
  };
  state.invitations.set(invitation.id, invitation);
  pushActivity(state, user.id, workspaceId, null, "member.invited", {
    email,
    role: role as string,
  });
  return invitation;
}

export function handleListInvitations(
  state: MockWorkspaceState,
  token: string | null,
): WorkspaceInvitation[] {
  const user = requireUser(token);
  const now = nowIso();
  return [...state.invitations.values()]
    .filter((i) => i.recipientEmail === user.email && i.status === "pending" && i.expiresAt > now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function handleListWorkspaceInvitations(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
): WorkspaceInvitation[] {
  const user = requireUser(token);
  requireOwner(state, user, workspaceId);
  return [...state.invitations.values()]
    .filter((i) => i.workspaceId === workspaceId && i.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function handleAcceptInvitation(
  state: MockWorkspaceState,
  token: string | null,
  invitationId: string,
): void {
  const user = requireUser(token);
  const invitation = state.invitations.get(invitationId);
  if (!invitation || invitation.status !== "pending") {
    throw new MockWorkspaceError(400, "INVITE_INVALID", "That invitation is no longer valid.");
  }
  if (invitation.expiresAt <= nowIso()) {
    invitation.status = "expired";
    throw new MockWorkspaceError(400, "INVITE_EXPIRED", "That invitation has expired.");
  }
  if (invitation.recipientEmail !== user.email) {
    // Never confirm whether an invitation exists for another email.
    throw new MockWorkspaceError(400, "INVITE_INVALID", "That invitation isn't for this account.");
  }
  const workspace = state.workspaces.get(invitation.workspaceId);
  if (!workspace) {
    throw new MockWorkspaceError(400, "INVITE_INVALID", "That workspace no longer exists.");
  }
  workspace.members.set(user.id, invitation.role);
  invitation.status = "accepted";
  invitation.acceptedAt = nowIso();
  workspace.updatedAt = nowIso();
  pushActivity(state, user.id, invitation.workspaceId, null, "member.joined", {
    role: invitation.role as string,
  });
}

export function handleRevokeInvitation(
  state: MockWorkspaceState,
  token: string | null,
  invitationId: string,
): void {
  const user = requireUser(token);
  const invitation = state.invitations.get(invitationId);
  if (!invitation) return;
  requireOwner(state, user, invitation.workspaceId);
  if (invitation.status === "pending") {
    invitation.status = "revoked";
  }
}

// ---------------------------------------------------------------------------
// Workspace projects (server-authoritative)
// ---------------------------------------------------------------------------

function serializeProjectPayload(project: unknown): {
  payload: string;
  name: string;
} {
  // Deep-clone + validate through the canonical ProjectSchema. Never store
  // local-only runtime metadata (payload is Project-shaped only).
  const parsed = ProjectSchema.safeParse(JSON.parse(JSON.stringify(project)));
  if (!parsed.success) {
    throw new MockWorkspaceError(400, "PAYLOAD_INVALID", "This project couldn't be validated.");
  }
  const nameValidation = validateProjectName(parsed.data.name);
  if (!nameValidation.valid) {
    throw new MockWorkspaceError(400, "PAYLOAD_INVALID", nameValidation.error ?? "This project couldn't be validated.");
  }
  const payload = JSON.stringify(parsed.data);
  const bytes = new TextEncoder().encode(payload).length;
  if (bytes > WORKSPACE_PROJECT_MAX_BYTES) {
    throw new MockWorkspaceError(413, "PAYLOAD_TOO_LARGE", "This project is too large to share.");
  }
  return { payload, name: parsed.data.name };
}

export function handleCreateWorkspaceProject(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  input: { projectId?: unknown; project?: unknown; origin?: unknown },
): WorkspaceProjectSummary {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  if (!isValidId(projectId)) {
    throw new MockWorkspaceError(400, "INVALID_INPUT", "That project isn't valid.");
  }
  if (state.projects.has(projectKey(workspaceId, projectId))) {
    throw new MockWorkspaceError(409, "INVALID_INPUT", "That project already exists in this workspace.");
  }
  const { payload, name } = serializeProjectPayload(input.project);
  const now = nowIso();
  const project: MockWorkspaceProject = {
    workspaceId,
    projectId,
    name,
    payload,
    revision: 1,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  state.projects.set(projectKey(workspaceId, projectId), project);
  const origin = input.origin === "move-in" ? "move-in" : "create";
  pushActivity(
    state,
    user.id,
    workspaceId,
    projectId,
    origin === "move-in" ? "project.moved_in" : "project.created",
    { project: name },
  );
  return toProjectSummary(project);
}

export function handleListWorkspaceProjects(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
): WorkspaceProjectSummary[] {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  return [...state.projects.values()]
    .filter((p) => p.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toProjectSummary);
}

export function handleFetchWorkspaceProject(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): WorkspaceProjectFull {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  const project = requireProject(state, workspaceId, projectId);
  return {
    ...toProjectSummary(project),
    project: JSON.parse(project.payload) as WorkspaceProjectFull["project"],
  };
}

export function handleSaveWorkspaceProject(
  state: MockWorkspaceState,
  token: string | null,
  input: {
    workspaceId?: unknown;
    projectId?: unknown;
    project?: unknown;
    expectedRevision?: unknown;
  },
): WorkspaceProjectSummary {
  const user = requireUser(token);
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : "";
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  requireEditor(state, user, workspaceId);
  const project = requireProject(state, workspaceId, projectId);

  // Optimistic concurrency: the expected revision must match exactly.
  const expectedRevision = typeof input.expectedRevision === "number" ? input.expectedRevision : -1;
  if (project.revision !== expectedRevision) {
    throw new MockWorkspaceError(409, "STALE_REVISION", "This project changed since you opened it.");
  }

  const { payload, name } = serializeProjectPayload(input.project);
  const renamed = name !== project.name;
  project.payload = payload;
  project.name = name;
  project.revision += 1;
  project.updatedAt = nowIso();
  // Version history: a changed-content save creates a deduped autosave version
  // and records meaningful activity (identical saves are silent).
  const version = pushVersion(state, {
    workspaceId,
    projectId,
    revision: project.revision,
    createdBy: user.id,
    reason: "autosave",
    snapshot: payload,
  });
  if (version) {
    pushActivity(state, user.id, workspaceId, projectId, "project.saved", {
      revision: project.revision,
    });
  }
  if (renamed) {
    pushActivity(state, user.id, workspaceId, projectId, "project.renamed", {
      project: name,
      to: name,
    });
  }
  return toProjectSummary(project);
}

export function handleDeleteWorkspaceProject(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): void {
  const user = requireUser(token);
  requireOwner(state, user, workspaceId);
  const project = state.projects.get(projectKey(workspaceId, projectId));
  state.projects.delete(projectKey(workspaceId, projectId));
  // Leases are scoped by (workspace, project) — never touch another
  // workspace's same-id project.
  state.leases.delete(projectKey(workspaceId, projectId));
  // Phase P15: versions are removed with the project; presence sessions for
  // the project end; activity retains a safe metadata tombstone.
  state.versions.delete(versionKey(workspaceId, projectId));
  // Phase P16: the collaboration room dies with the project.
  state.collabRooms.delete(collabRoomKey(workspaceId, projectId));
  purgeProjectPresence(state, workspaceId, projectId);
  if (project) {
    pushActivity(state, user.id, workspaceId, projectId, "project.deleted", {
      project: project.name,
    });
  }
}

export function handleDuplicateWorkspaceProject(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  input: { newProjectId?: unknown; name?: unknown },
): WorkspaceProjectSummary {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  const source = requireProject(state, workspaceId, projectId);
  const newProjectId = typeof input.newProjectId === "string" ? input.newProjectId : "";
  if (!isValidId(newProjectId)) {
    throw new MockWorkspaceError(400, "INVALID_INPUT", "That project isn't valid.");
  }
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 80)
      : `${source.name} Copy`;
  const now = nowIso();
  const project: MockWorkspaceProject = {
    workspaceId,
    projectId: newProjectId,
    name,
    payload: source.payload, // content copy, fresh identity
    revision: 1,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  state.projects.set(projectKey(workspaceId, newProjectId), project);
  pushActivity(state, user.id, workspaceId, newProjectId, "project.duplicated", {
    project: name,
    from: source.name,
  });
  return toProjectSummary(project);
}

// ---------------------------------------------------------------------------
// Phase P15 — activity public handlers (client bridges: publish/share/domain)
// ---------------------------------------------------------------------------

export function handleRecordActivityEvent(
  state: MockWorkspaceState,
  token: string | null,
  input: { workspaceId?: unknown; projectId?: unknown; type?: unknown; metadata?: unknown },
): WorkspaceActivityEvent {
  const user = requireUser(token);
  const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : "";
  requireMember(state, user, workspaceId);
  const type = typeof input.type === "string" ? input.type : "";
  if (!ACTIVITY_TYPES.has(type)) {
    throw new MockWorkspaceError(400, "INVALID_INPUT", "That activity event isn't supported.");
  }
  let projectId: string | null = null;
  if (input.projectId !== undefined && input.projectId !== null && input.projectId !== "") {
    projectId = typeof input.projectId === "string" ? input.projectId : "";
    if (!isValidId(projectId)) {
      throw new MockWorkspaceError(400, "INVALID_INPUT", "That project isn't valid.");
    }
    requireProject(state, workspaceId, projectId);
  }
  const metadata = sanitizeActivityMetadata(type, input.metadata);
  return pushActivity(state, user.id, workspaceId, projectId, type as WorkspaceActivityType, metadata);
}

const FILTER_TYPES: Record<string, ReadonlySet<WorkspaceActivityType>> = {
  projects: new Set<WorkspaceActivityType>([
    "project.created",
    "project.moved_in",
    "project.renamed",
    "project.saved",
    "project.duplicated",
    "project.deleted",
    "project.version_created",
    "project.version_restored",
  ]),
  members: new Set<WorkspaceActivityType>([
    "member.invited",
    "member.joined",
    "member.role_changed",
    "member.removed",
  ]),
  publishing: new Set<WorkspaceActivityType>([
    "publish.completed",
    "publish.rollback",
    "domain.attached",
    "domain.removed",
  ]),
  sharing: new Set<WorkspaceActivityType>(["share.created", "share.revoked"]),
};

function parseActivityCursor(raw: unknown): ActivityCursor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.ts === "string" && typeof obj.id === "string") {
    return { ts: obj.ts, id: obj.id };
  }
  return null;
}

export function handleListActivity(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  opts: { before?: unknown; limit?: unknown; filter?: unknown },
): { events: WorkspaceActivityEvent[]; nextCursor: ActivityCursor | null } {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  const limit = Math.min(
    Math.max(typeof opts.limit === "number" ? Math.floor(opts.limit) : ACTIVITY_PAGE_SIZE, 1),
    ACTIVITY_PAGE_SIZE,
  );
  let list = state.activity.get(workspaceId) ?? [];
  const filter = typeof opts.filter === "string" ? opts.filter : "all";
  if (filter !== "all" && FILTER_TYPES[filter]) {
    list = list.filter((e) => FILTER_TYPES[filter].has(e.type));
  }
  // Deterministic ordering: (createdAt DESC, id DESC). Events created in the
  // same millisecond (common in tight loops) must still page correctly, so the
  // cursor filter runs against a fully sorted copy — never insertion order.
  list = [...list].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  const before = parseActivityCursor(opts.before);
  if (before) {
    list = list.filter(
      (e) => e.createdAt < before.ts || (e.createdAt === before.ts && e.id < before.id),
    );
  }
  const page = list.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    page.length === limit && list.length > limit
      ? { ts: last.createdAt, id: last.id }
      : null;
  // Enrich with server-derived actor display names (never client-supplied).
  const events = page.map((e) => ({ ...e, actorName: displayNameOf(state, e.actorUserId) }));
  return { events, nextCursor };
}

// ---------------------------------------------------------------------------
// Edit leases
// ---------------------------------------------------------------------------

function isLeaseActive(lease: ProjectEditLease, now = Date.now()): boolean {
  return new Date(lease.expiresAt).getTime() > now;
}

export function handleAcquireEditLease(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): LeaseAcquireResult {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  requireProject(state, workspaceId, projectId);

  // Leases are scoped by (workspace, project) so a same-id project in another
  // workspace can never block or be released by this workspace's session.
  const existing = state.leases.get(projectKey(workspaceId, projectId));
  if (existing) {
    if (existing.userId === user.id) {
      // Renew own lease.
      const now = nowIso();
      existing.acquiredAt = now;
      existing.expiresAt = new Date(Date.now() + EDIT_LEASE_DURATION_MS).toISOString();
      existing.heartbeatAt = now;
      return { ok: true, lease: withHolderEmail(state, existing) };
    }
    if (isLeaseActive(existing)) {
      return { ok: false, code: "LEASE_HELD", lease: withHolderEmail(state, existing) };
    }
    // Stale lease → replace (workspace-scoped).
    state.leases.delete(projectKey(workspaceId, projectId));
  }

  const leaseId = `lease-${randomUUID()}-${randomBytes(4).toString("hex")}`;
  const now = nowIso();
  const lease: ProjectEditLease = {
    projectId,
    workspaceId,
    leaseId,
    userId: user.id,
    acquiredAt: now,
    expiresAt: new Date(Date.now() + EDIT_LEASE_DURATION_MS).toISOString(),
    heartbeatAt: now,
  };
  state.leases.set(projectKey(workspaceId, projectId), lease);
  return { ok: true, lease: withHolderEmail(state, lease) };
}

export function handleHeartbeatEditLease(
  state: MockWorkspaceState,
  token: string | null,
  leaseId: string,
): ProjectEditLease {
  const user = requireUser(token);
  const lease = [...state.leases.values()].find((l) => l.leaseId === leaseId);
  if (!lease || lease.userId !== user.id) {
    throw new MockWorkspaceError(403, "LEASE_INVALID", "Your editing session ended.");
  }
  if (!isLeaseActive(lease)) {
    state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
    throw new MockWorkspaceError(403, "LEASE_INVALID", "Your editing session ended.");
  }
  lease.heartbeatAt = nowIso();
  lease.expiresAt = new Date(Date.now() + EDIT_LEASE_DURATION_MS).toISOString();
  return withHolderEmail(state, lease);
}

export function handleReleaseEditLease(
  state: MockWorkspaceState,
  token: string | null,
  leaseId: string,
): void {
  const user = requireUser(token);
  const lease = [...state.leases.values()].find((l) => l.leaseId === leaseId);
  if (!lease) return;
  if (lease.userId !== user.id) {
    throw new MockWorkspaceError(403, "LEASE_INVALID", "You can't release someone else's editing session.");
  }
  state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
}

export function handleGetEditLease(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): ProjectEditLease | null {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  const lease = state.leases.get(projectKey(workspaceId, projectId));
  if (!lease) return null;
  if (!isLeaseActive(lease)) {
    state.leases.delete(projectKey(workspaceId, projectId));
    return null;
  }
  return withHolderEmail(state, lease);
}

export function handleRevokeLeasesForProject(
  state: MockWorkspaceState,
  token: string | null,
  projectId: string,
): void {
  const user = requireUser(token);
  // Any member of an owning workspace may request revocation for cleanup
  // (server verifies membership per lease's workspace). With workspace-scoped
  // leases the same project id can exist in several workspaces — only leases
  // in workspaces the caller belongs to are revoked; leases in workspaces the
  // caller is not a member of are skipped (never thrown on, never touched).
  for (const lease of [...state.leases.values()]) {
    if (lease.projectId !== projectId) continue;
    const workspace = state.workspaces.get(lease.workspaceId);
    if (!workspace) continue;
    const allowed = workspace.ownerId === user.id || workspace.members.has(user.id);
    if (!allowed) continue;
    state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
  }
}

// ---------------------------------------------------------------------------
// Phase P16 — collaboration rooms
// ---------------------------------------------------------------------------

const COLLAB_ROOM_MAX_UPDATE_BYTES = 256 * 1024; // 256 KB (architecture §39)
// Per-room send ceiling (Phase P17 — F4). Architecture §39 documents a mock
// per-room rate limit; it is the DoS guard against a compromised editor
// flooding the room log with tiny updates. Generous enough to never trip
// legitimate typing / AI-plan bursts / E2E, tight enough to bound a flood.
const COLLAB_ROOM_SEND_RATE_MAX = 2400; // per window
const COLLAB_ROOM_SEND_RATE_WINDOW_MS = 60_000; // 60 s

export interface CollabJoinResult {
  seq: number;
  checkpointSeq: number;
  base: unknown;
  /** Canonical shared Yjs state (base64) when the room already has one. */
  state?: string;
}

export interface CollabSeedResult {
  state: string | null;
}

export interface CollabPollResult {
  seq: number;
  checkpointSeq: number;
  rebase: boolean;
  base?: unknown;
  updates: Array<{ seq: number; data: string; actorClientId?: string }>;
}

export interface CollabSendResult {
  seq: number;
}

function collabRoomKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

/** Get (or lazily create) the room for a workspace project. */
function getCollabRoom(
  state: MockWorkspaceState,
  workspaceId: string,
  projectId: string,
): MockCollabRoom {
  const key = collabRoomKey(workspaceId, projectId);
  let room = state.collabRooms.get(key);
  if (!room) {
    room = {
      workspaceId,
      projectId,
      seq: 0,
      checkpointSeq: 0,
      updates: [],
      lockHolder: null,
      canonicalState: null,
    };
    state.collabRooms.set(key, room);
  }
  return room;
}

/** The durable base for a room — always the current workspace project payload. */
function collabRoomBase(
  state: MockWorkspaceState,
  workspaceId: string,
  projectId: string,
): unknown {
  const project = requireProject(state, workspaceId, projectId);
  return JSON.parse(project.payload) as unknown;
}

/**
 * Advance the room's durable checkpoint frontier to `seq` and prune the
 * retained update log below it (bounded growth — architecture §26).
 */
function advanceCollabCheckpoint(
  state: MockWorkspaceState,
  workspaceId: string,
  projectId: string,
  seq: number,
): void {
  const room = getCollabRoom(state, workspaceId, projectId);
  if (seq > room.checkpointSeq) {
    room.checkpointSeq = Math.min(seq, room.seq);
  }
  room.updates = room.updates.filter((u) => u.seq > room.checkpointSeq);
}

/** Join the room — returns the durable base + the room frontier it corresponds to. */
export function handleCollabJoin(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): CollabJoinResult {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  const room = getCollabRoom(state, workspaceId, projectId);
  return {
    seq: room.seq,
    checkpointSeq: room.checkpointSeq,
    base: collabRoomBase(state, workspaceId, projectId),
    ...(room.canonicalState ? { state: room.canonicalState } : {}),
  };
}

/** Decode a base64 string to bytes; null when malformed. */
function tryBase64Decode(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Seed the room with the first joiner's init state (first writer wins). A
 * client that loses the race receives the winner's state and re-applies it.
 * Editors/owners only — a viewer must never poison canonical room state.
 */
export function handleCollabSeed(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  input: { state?: unknown },
): CollabSeedResult {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  if (typeof input.state !== "string" || input.state.length === 0) {
    throw new MockWorkspaceError(400, "PAYLOAD_INVALID", "That update isn't valid.");
  }
  // Size-cap the DECODED payload (base64 is 4/3 the binary size) — parity with
  // the Supabase path's octet_length(bytea) check (architecture §39).
  const bytes = tryBase64Decode(input.state);
  if (bytes === null) {
    throw new MockWorkspaceError(400, "PAYLOAD_INVALID", "That update isn't valid.");
  }
  if (bytes.byteLength > COLLAB_ROOM_MAX_UPDATE_BYTES) {
    throw new MockWorkspaceError(413, "PAYLOAD_TOO_LARGE", "That state is too large to share.");
  }
  const room = getCollabRoom(state, workspaceId, projectId);
  if (room.canonicalState) {
    // Another client won the seed — tell this client to apply theirs.
    return { state: room.canonicalState };
  }
  room.canonicalState = input.state;
  return { state: null };
}

/** Relay one binary Yjs update from an editor/owner. Viewers/removed → 403. */
export function handleCollabSend(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  input: { update?: unknown; actorClientId?: unknown },
): CollabSendResult {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  const room = getCollabRoom(state, workspaceId, projectId);

  // Per-room send rate limit (Phase P17 — F4): a flood of tiny updates would
  // otherwise grow the retained log and amplify poll work for every peer.
  if (
    rateLimited(
      state.collabSendAttempts,
      collabRoomKey(workspaceId, projectId),
      COLLAB_ROOM_SEND_RATE_MAX,
      COLLAB_ROOM_SEND_RATE_WINDOW_MS,
    )
  ) {
    throw new MockWorkspaceError(429, "RATE_LIMITED", "Too many changes at once. Try again shortly.");
  }

  // Maintenance lock (restore/import) pauses collaborative writes.
  if (room.lockHolder && room.lockHolder !== user.id) {
    throw new MockWorkspaceError(
      409,
      "LOCKED",
      "This project is being updated by its owner right now.",
    );
  }

  if (typeof input.update !== "string" || input.update.length === 0) {
    throw new MockWorkspaceError(400, "PAYLOAD_INVALID", "That update isn't valid.");
  }
  // Size-cap the DECODED payload — parity with the Supabase path's
  // octet_length(bytea) check (architecture §39).
  const bytes = tryBase64Decode(input.update);
  if (bytes === null) {
    throw new MockWorkspaceError(400, "PAYLOAD_INVALID", "That update isn't valid.");
  }
  if (bytes.byteLength > COLLAB_ROOM_MAX_UPDATE_BYTES) {
    throw new MockWorkspaceError(413, "PAYLOAD_TOO_LARGE", "That change is too large to share.");
  }

  room.seq += 1;
  const seq = room.seq;
  room.updates.push({
    seq,
    data: input.update,
    actorClientId: typeof input.actorClientId === "string" ? input.actorClientId : "",
    at: nowIso(),
  });
  // Phase P17 (F1) — the room NEVER drops an update that has not been durably
  // checkpointed. A shift here silently deletes un-checkpointed updates
  // WITHOUT advancing the frontier, so laggards and late joiners would miss
  // them with no rebase (the exact divergence P16 exists to prevent). Growth
  // is bounded the same way the Supabase path bounds it: prune ONLY at
  // checkpoint (advanceCollabCheckpoint), which the 1.5 s checkpoint debounce
  // makes small in practice. The per-room send ceiling above bounds floods.
  return { seq };
}

/**
 * Poll for updates after `afterSeq`. Falling behind the pruned frontier is
 * reported as a rebase (the client re-inits from the durable base) — never a
 * silent gap.
 */
export function handleCollabPoll(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  afterSeqRaw: unknown,
): CollabPollResult {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  const room = getCollabRoom(state, workspaceId, projectId);
  const afterSeq = typeof afterSeqRaw === "number" ? afterSeqRaw : -1;

  if (afterSeq < room.checkpointSeq) {
    // Fell behind the durable frontier → rebase from the checkpoint.
    return {
      seq: room.seq,
      checkpointSeq: room.checkpointSeq,
      rebase: true,
      base: collabRoomBase(state, workspaceId, projectId),
      updates: [],
    };
  }
  return {
    seq: room.seq,
    checkpointSeq: room.checkpointSeq,
    rebase: false,
    updates: room.updates
      .filter((u) => u.seq > afterSeq)
      .map((u) => ({ seq: u.seq, data: u.data, actorClientId: u.actorClientId })),
  };
}

/** Prune the room's retained log after a durable save (P15 save path). */
export function handleCollabCheckpoint(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
  input: { seq?: unknown; state?: unknown },
): void {
  const user = requireUser(token);
  requireEditor(state, user, workspaceId);
  const seq = typeof input.seq === "number" ? input.seq : -1;
  // Refresh the canonical state BEFORE pruning (never prune then lose the
  // snapshot a late joiner needs). Size-capped on the DECODED payload for
  // parity with Supabase (architecture §39).
  if (typeof input.state === "string" && input.state.length > 0) {
    const bytes = tryBase64Decode(input.state);
    if (bytes !== null && bytes.byteLength <= COLLAB_ROOM_MAX_UPDATE_BYTES) {
      const room = getCollabRoom(state, workspaceId, projectId);
      room.canonicalState = input.state;
    }
  }
  advanceCollabCheckpoint(state, workspaceId, projectId, seq);
}

/** Owner-only maintenance lock (version restore / import coordination). */
export function handleCollabLock(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): void {
  const user = requireUser(token);
  requireOwner(state, user, workspaceId);
  const room = getCollabRoom(state, workspaceId, projectId);
  if (room.lockHolder && room.lockHolder !== user.id) {
    throw new MockWorkspaceError(409, "LOCKED", "Another owner is updating this project right now.");
  }
  room.lockHolder = user.id;
}

export function handleCollabUnlock(
  state: MockWorkspaceState,
  token: string | null,
  workspaceId: string,
  projectId: string,
): void {
  const user = requireUser(token);
  requireMember(state, user, workspaceId);
  const room = getCollabRoom(state, workspaceId, projectId);
  if (room.lockHolder === user.id) {
    room.lockHolder = null;
  }
}

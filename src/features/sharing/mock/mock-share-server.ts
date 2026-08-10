// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — mock share backend
// (DEV/TEST ONLY)
//
// In-memory stand-in for the Supabase share tables, exposed through Next.js
// API routes (/api/share/...) so the full feature (create, manage, revoke,
// regenerate, expire, feedback) is exercisable end-to-end without
// credentials. State lives on the dev-server process, so two browser
// contexts hitting the same dev server share one "cloud" — that is what
// makes cross-device share E2E possible.
//
// Security posture mirrors the real backend:
//   - bearer sessions (shared with the Phase P6 mock cloud state); every
//     owner endpoint requires a valid token + ownership (like RLS)
//   - raw tokens are never stored — only SHA-256 hashes
//   - revocation and expiration are enforced on EVERY public resolve and
//     comment submit (no client cache can override them)
//   - anonymous feedback is rate-limited per share with a duplicate guard
//   - only the sanitized projection is ever stored for viewers
// ---------------------------------------------------------------------------

import { randomBytes, randomUUID } from "node:crypto";
import { getMockCloudState } from "@/features/cloud-sync/mock/mock-cloud-server";
import { getMockWorkspaceState } from "@/features/workspaces/mock/mock-workspace-server";
import {
  COMMENT_BODY_MAX,
  COMMENT_DUPLICATE_WINDOW_MS,
  COMMENT_NAME_MAX,
  COMMENT_RATE_LIMIT_MAX,
  COMMENT_RATE_LIMIT_WINDOW_MS,
  PROJECTION_MAX_BYTES,
} from "../constants";
import { hashShareTokenSync } from "../token";
import { parseProjection } from "../projection/sanitize-share-projection";
import type {
  ReviewComment,
  ShareExpiryPreset,
  ShareLinkStatus,
  ShareLinkSummary,
} from "../types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface MockShareRecord {
  id: string;
  ownerId: string;
  projectId: string;
  tokenHash: string;
  status: ShareLinkStatus;
  feedbackEnabled: boolean;
  requireName: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  feedbackCount: number;
  projection: string | null;
  projectionRevision: number | null;
  projectionUpdatedAt: string | null;
}

export interface MockShareState {
  /** share id -> record */
  shares: Map<string, MockShareRecord>;
  /** tokenHash -> share id */
  tokens: Map<string, string>;
  /** share id -> comments (createdAt asc) */
  comments: Map<string, ReviewComment[]>;
  /** share id -> submission timestamps (rate limit bucket) */
  commentAttempts: Map<string, number[]>;
  /** share id -> last submission signature (duplicate guard) */
  lastComment: Map<string, { signature: string; at: number }>;
}

export function createMockShareState(): MockShareState {
  return {
    shares: new Map(),
    tokens: new Map(),
    comments: new Map(),
    commentAttempts: new Map(),
    lastComment: new Map(),
  };
}

// The mock share backend lives on globalThis (NOT a module-local variable):
// in Next.js dev every route handler is its own webpack bundle, so a
// module-level singleton would be duplicated per route. globalThis is shared
// by every route bundle in the dev-server process (same pattern as the P6
// mock cloud), which is what makes cross-route + cross-device E2E possible.
const MOCK_SHARE_GLOBAL_KEY = "buildora.mockShareState.v1";

export function getMockShareState(): MockShareState {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[MOCK_SHARE_GLOBAL_KEY];
  if (existing) return existing as MockShareState;
  const fresh = createMockShareState();
  g[MOCK_SHARE_GLOBAL_KEY] = fresh;
  return fresh;
}

export function resetMockShareState(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g[MOCK_SHARE_GLOBAL_KEY] = createMockShareState();
}

// ---------------------------------------------------------------------------
// Errors & helpers
// ---------------------------------------------------------------------------

export class MockShareError extends Error {
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

/** Resolve the authenticated owner from a bearer token (P6 session store). */
function requireOwner(token: string | null): { id: string; email: string } {
  if (!token) {
    throw new MockShareError(401, "AUTH_REQUIRED", "Sign in to continue.");
  }
  const state = getMockCloudState();
  const userId = state.sessions.get(token);
  if (!userId) {
    throw new MockShareError(401, "SESSION_EXPIRED", "Your session ended. Sign in again.");
  }
  const user = [...state.users.values()].find((u) => u.id === userId);
  if (!user) {
    throw new MockShareError(401, "SESSION_EXPIRED", "Your session ended. Sign in again.");
  }
  return { id: user.id, email: user.email };
}

function requireShare(state: MockShareState, shareId: string): MockShareRecord {
  const record = state.shares.get(shareId);
  if (!record) {
    throw new MockShareError(404, "NOT_FOUND", "That review link could not be found.");
  }
  return record;
}

function requireOwnerOfShare(
  state: MockShareState,
  token: string | null,
  shareId: string,
): MockShareRecord {
  const owner = requireOwner(token);
  const record = requireShare(state, shareId);
  if (record.ownerId !== owner.id) {
    throw new MockShareError(403, "PERMISSION_DENIED", "Only the owner can manage this review link.");
  }
  // Phase P14: workspace projects require the caller to STILL hold owner/editor
  // role in the owning workspace (removed/downgraded members lose management
  // access immediately — mirror of the Supabase gate).
  const wsAccess = workspaceShareRoleForProject(record.projectId, owner.id);
  if (wsAccess && wsAccess.role !== "owner" && wsAccess.role !== "editor") {
    throw new MockShareError(403, "PERMISSION_DENIED", "You no longer have permission to manage this review link.");
  }
  return record;
}

function isExpired(record: MockShareRecord, now = Date.now()): boolean {
  return record.expiresAt !== null && new Date(record.expiresAt).getTime() <= now;
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

function toSummary(record: MockShareRecord): ShareLinkSummary {
  return {
    id: record.id,
    projectId: record.projectId,
    status: record.status,
    feedbackEnabled: record.feedbackEnabled,
    requireName: record.requireName,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastOpenedAt: record.lastOpenedAt,
    feedbackCount: record.feedbackCount,
  };
}

const EXPIRY_MS: Record<ShareExpiryPreset, number | null> = {
  never: null,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function parseExpiry(input: { preset?: unknown; expiresAt?: unknown }): string | null {
  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null) return null;
    if (typeof input.expiresAt === "string") {
      const t = new Date(input.expiresAt).getTime();
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
    throw new MockShareError(400, "INVALID_INPUT", "That expiration isn't valid.");
  }
  const preset = typeof input.preset === "string" ? input.preset : "never";
  if (!(preset in EXPIRY_MS)) {
    throw new MockShareError(400, "INVALID_INPUT", "That expiration isn't valid.");
  }
  const ms = EXPIRY_MS[preset as ShareExpiryPreset];
  return ms === null ? null : new Date(Date.now() + ms).toISOString();
}

function validateProjectId(projectId: unknown): string {
  if (typeof projectId !== "string" || projectId.length === 0 || projectId.length > 200) {
    throw new MockShareError(400, "INVALID_INPUT", "That project isn't valid.");
  }
  return projectId;
}

/**
 * Phase P14 — workspace-aware share gate.
 *
 * If the project is a WORKSPACE project, only workspace members with owner or
 * editor role may create/manage review links (mirrors the permission matrix
 * and the Supabase RPC gate in the P14 migration). A project id is only
 * unique WITHIN a workspace, so when the same id exists in several
 * workspaces the caller must hold owner/editor role in EVERY one of them — a
 * viewer or non-member in any workspace holding the id is denied.
 * Personal projects keep the P12 behavior (any signed-in owner may share).
 */
function workspaceShareRoleForProject(
  projectId: string,
  userId: string,
): { role: "owner" | "editor" | "viewer" } | null {
  const wsState = getMockWorkspaceState();
  let found = false;
  for (const project of wsState.projects.values()) {
    if (project.projectId !== projectId) continue;
    found = true;
    const workspace = wsState.workspaces.get(project.workspaceId);
    if (!workspace) return { role: "viewer" };
    if (workspace.ownerId === userId) continue;
    // Viewer or non-member in this workspace → denied for this project id.
    if (workspace.members.get(userId) !== "editor") return { role: "viewer" };
  }
  if (!found) return null;
  // Owner/editor in every workspace holding this project id.
  return { role: "owner" };
}

// ---------------------------------------------------------------------------
// Owner handlers
// ---------------------------------------------------------------------------

export interface CreateShareInput {
  projectId?: unknown;
  feedbackEnabled?: unknown;
  requireName?: unknown;
  preset?: unknown;
  expiresAt?: unknown;
}

export function handleCreateShare(
  state: MockShareState,
  token: string | null,
  input: CreateShareInput,
  origin: string,
): { link: ShareLinkSummary; rawToken: string; url: string } {
  const owner = requireOwner(token);
  const projectId = validateProjectId(input.projectId);

  // Phase P14: workspace projects may only be shared by owner/editor members.
  const wsAccess = workspaceShareRoleForProject(projectId, owner.id);
  if (wsAccess && wsAccess.role !== "owner" && wsAccess.role !== "editor") {
    throw new MockShareError(403, "PERMISSION_DENIED", "Only workspace editors can create review links for this project.");
  }
  const feedbackEnabled = input.feedbackEnabled === true;
  const requireName = input.requireName === true && feedbackEnabled;
  const expiresAt = parseExpiry(input);

  // Generate the raw token + id; only the hash is stored.
  const rawToken = randomToken();
  const tokenHash = hashShareTokenSync(rawToken);
  const now = nowIso();
  const record: MockShareRecord = {
    id: `share-${randomUUID()}`,
    ownerId: owner.id,
    projectId,
    tokenHash,
    status: "active",
    feedbackEnabled,
    requireName,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null,
    feedbackCount: 0,
    projection: null,
    projectionRevision: null,
    projectionUpdatedAt: null,
  };
  state.shares.set(record.id, record);
  state.tokens.set(tokenHash, record.id);
  state.comments.set(record.id, []);
  state.commentAttempts.set(record.id, []);
  return {
    link: toSummary(record),
    rawToken,
    url: `${origin}/share/${rawToken}`,
  };
}

export function handleListShares(
  state: MockShareState,
  token: string | null,
  projectId: string,
): ShareLinkSummary[] {
  const owner = requireOwner(token);
  // Phase P14: viewers / non-members must not enumerate workspace-project links.
  const wsAccess = workspaceShareRoleForProject(projectId, owner.id);
  if (wsAccess && wsAccess.role !== "owner" && wsAccess.role !== "editor") {
    return [];
  }
  return [...state.shares.values()]
    .filter((r) => r.ownerId === owner.id && r.projectId === projectId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toSummary);
}

export function handleShareStatusBatch(
  state: MockShareState,
  token: string | null,
  projectIds: string[],
): Record<string, boolean> {
  const owner = requireOwner(token);
  const out: Record<string, boolean> = {};
  for (const projectId of projectIds) {
    // Phase P14: workspace projects are badge-visible only to owner/editor.
    const wsAccess = workspaceShareRoleForProject(projectId, owner.id);
    if (wsAccess && wsAccess.role !== "owner" && wsAccess.role !== "editor") {
      out[projectId] = false;
      continue;
    }
    out[projectId] = [...state.shares.values()].some(
      (r) =>
        r.ownerId === owner.id &&
        r.projectId === projectId &&
        r.status === "active" &&
        !isExpired(r),
    );
  }
  return out;
}

export function handleUpdateShare(
  state: MockShareState,
  token: string | null,
  shareId: string,
  patch: { feedbackEnabled?: unknown; requireName?: unknown; preset?: unknown; expiresAt?: unknown },
): ShareLinkSummary {
  const record = requireOwnerOfShare(state, token, shareId);
  if (record.status === "revoked") {
    throw new MockShareError(400, "REVOKED", "That review link has been revoked.");
  }
  if (patch.feedbackEnabled !== undefined) {
    record.feedbackEnabled = patch.feedbackEnabled === true;
  }
  if (patch.requireName !== undefined) {
    record.requireName = patch.requireName === true && record.feedbackEnabled;
  }
  if (patch.preset !== undefined || patch.expiresAt !== undefined) {
    record.expiresAt = parseExpiry(patch);
  }
  record.updatedAt = nowIso();
  return toSummary(record);
}

export function handlePushSnapshot(
  state: MockShareState,
  token: string | null,
  shareId: string,
  body: { projection?: unknown; projectionRevision?: unknown },
): void {
  const record = requireOwnerOfShare(state, token, shareId);
  const projection = typeof body.projection === "string" ? body.projection : "";
  if (!projection) {
    throw new MockShareError(400, "INVALID_INPUT", "The website snapshot is missing.");
  }
  const size = new TextEncoder().encode(projection).length;
  if (size > PROJECTION_MAX_BYTES) {
    throw new MockShareError(413, "PROJECTION_TOO_LARGE", "This website is too large to share.");
  }
  // Defense: the stored projection must re-parse cleanly.
  if (!parseProjection(projection)) {
    throw new MockShareError(400, "INVALID_INPUT", "The website snapshot isn't valid.");
  }
  record.projection = projection;
  record.projectionRevision =
    typeof body.projectionRevision === "number" ? body.projectionRevision : null;
  record.projectionUpdatedAt = nowIso();
  record.updatedAt = nowIso();
}

export function handleRegenerateShare(
  state: MockShareState,
  token: string | null,
  shareId: string,
  origin: string,
): { link: ShareLinkSummary; rawToken: string; url: string } {
  const record = requireOwnerOfShare(state, token, shareId);
  if (record.status === "revoked") {
    throw new MockShareError(400, "REVOKED", "That review link has been revoked.");
  }
  const oldHash = record.tokenHash;
  const rawToken = randomToken();
  const tokenHash = hashShareTokenSync(rawToken);
  state.tokens.delete(oldHash);
  record.tokenHash = tokenHash;
  record.updatedAt = nowIso();
  state.tokens.set(tokenHash, record.id);
  return { link: toSummary(record), rawToken, url: `${origin}/share/${rawToken}` };
}

export function handleRevokeShare(
  state: MockShareState,
  token: string | null,
  shareId: string,
): void {
  const record = requireOwnerOfShare(state, token, shareId);
  if (record.status === "active") {
    record.status = "revoked";
    record.updatedAt = nowIso();
  }
}

// ---------------------------------------------------------------------------
// Feedback handlers
// ---------------------------------------------------------------------------

export function handleListComments(
  state: MockShareState,
  token: string | null,
  shareId: string,
): ReviewComment[] {
  requireOwnerOfShare(state, token, shareId);
  return state.comments.get(shareId) ?? [];
}

export interface SubmitCommentInput {
  token?: unknown;
  pageId?: unknown;
  sectionId?: unknown;
  authorName?: unknown;
  body?: unknown;
}

export function handleSubmitComment(
  state: MockShareState,
  shareId: string,
  input: SubmitCommentInput,
): ReviewComment {
  const rawToken = typeof input.token === "string" ? input.token : "";
  const tokenHash = hashShareTokenSync(rawToken);
  const recordId = state.tokens.get(tokenHash);
  if (!recordId || recordId !== shareId) {
    throw new MockShareError(401, "INVALID_TOKEN", "This review link isn't working.");
  }
  const record = requireShare(state, shareId);
  if (record.status !== "active") {
    throw new MockShareError(410, "REVOKED", "This review link is no longer available.");
  }
  if (isExpired(record)) {
    throw new MockShareError(410, "EXPIRED", "This review link has expired.");
  }
  if (!record.feedbackEnabled) {
    throw new MockShareError(403, "FEEDBACK_DISABLED", "Feedback isn't enabled for this review link.");
  }

  // Rate limit (per share).
  if (rateLimited(state.commentAttempts, shareId, COMMENT_RATE_LIMIT_MAX, COMMENT_RATE_LIMIT_WINDOW_MS)) {
    throw new MockShareError(429, "RATE_LIMITED", "Too many comments. Please wait a moment.");
  }

  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > COMMENT_BODY_MAX) {
    throw new MockShareError(400, "INVALID_INPUT", "Your comment is empty or too long.");
  }
  const authorName =
    typeof input.authorName === "string" ? input.authorName.trim().slice(0, COMMENT_NAME_MAX) : "";
  if (record.requireName && !authorName) {
    throw new MockShareError(400, "INVALID_INPUT", "Please add your name.");
  }
  const pageId = typeof input.pageId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(input.pageId)
    ? input.pageId
    : undefined;
  const sectionId =
    typeof input.sectionId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(input.sectionId)
      ? input.sectionId
      : undefined;

  // Duplicate-spam guard: same body + name within the window is rejected.
  const signature = `${authorName}\u0000${body}`;
  const last = state.lastComment.get(shareId);
  const now = Date.now();
  if (last && last.signature === signature && now - last.at < COMMENT_DUPLICATE_WINDOW_MS) {
    throw new MockShareError(429, "RATE_LIMITED", "That comment was already sent. Please wait a moment.");
  }
  state.lastComment.set(shareId, { signature, at: now });

  const comment: ReviewComment = {
    id: `comment-${randomUUID()}`,
    shareId,
    projectId: record.projectId,
    ...(pageId ? { pageId } : {}),
    ...(sectionId ? { sectionId } : {}),
    ...(authorName ? { authorName } : {}),
    body,
    createdAt: nowIso(),
    resolvedAt: null,
  };
  const comments = state.comments.get(shareId) ?? [];
  comments.push(comment);
  state.comments.set(shareId, comments);
  record.feedbackCount += 1;
  record.updatedAt = nowIso();
  return comment;
}

export function handleSetCommentResolved(
  state: MockShareState,
  token: string | null,
  shareId: string,
  commentId: string,
  resolved: boolean,
): void {
  requireOwnerOfShare(state, token, shareId);
  const comments = state.comments.get(shareId) ?? [];
  const comment = comments.find((c) => c.id === commentId);
  if (!comment) {
    throw new MockShareError(404, "NOT_FOUND", "That comment could not be found.");
  }
  comment.resolvedAt = resolved ? nowIso() : null;
}

export function handleDeleteComment(
  state: MockShareState,
  token: string | null,
  shareId: string,
  commentId: string,
): void {
  const record = requireOwnerOfShare(state, token, shareId);
  const comments = state.comments.get(shareId) ?? [];
  const index = comments.findIndex((c) => c.id === commentId);
  if (index === -1) {
    throw new MockShareError(404, "NOT_FOUND", "That comment could not be found.");
  }
  comments.splice(index, 1);
  record.feedbackCount = Math.max(0, record.feedbackCount - 1);
}

// ---------------------------------------------------------------------------
// Public (anonymous) resolve
// ---------------------------------------------------------------------------

export function handleResolveShare(
  state: MockShareState,
  rawToken: string,
): { state: "active"; share: PublicShareInfo; projection: string } {
  const tokenHash = hashShareTokenSync(rawToken);
  const recordId = state.tokens.get(tokenHash);
  const record = recordId ? state.shares.get(recordId) : undefined;
  if (!record || !record.projection) {
    throw new MockShareError(404, "INVALID_TOKEN", "This review link isn't working.");
  }
  if (record.status !== "active") {
    throw new MockShareError(410, "REVOKED", "This review link is no longer available.");
  }
  if (isExpired(record)) {
    throw new MockShareError(410, "EXPIRED", "This review link has expired.");
  }
  // Privacy-conscious last-opened tracking: timestamp only, never an IP or
  // fingerprint. Best-effort (never fails the resolve).
  try {
    record.lastOpenedAt = nowIso();
  } catch {
    // ignore
  }
  return {
    state: "active",
    share: {
      shareId: record.id,
      // The canonical project id is NEVER public — blank it (matches the
      // Supabase resolve_share RPC, which also returns ''). Viewers never
      // need it; the token is the only authorization.
      projectId: "",
      projectName: "", // filled by the route from the projection
      feedbackEnabled: record.feedbackEnabled,
      requireName: record.requireName,
    },
    projection: record.projection,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Phase P14 — revoke every active review link for a project id (used when a
 * workspace project is deleted: deleted content must not remain shareable).
 * Scoped by project id across all owners; in the (UI-unreachable) case where
 * the same id exists in two workspaces, revoking is the safe direction.
 */
export function revokeActiveSharesForProject(
  state: MockShareState,
  projectId: string,
): number {
  let revoked = 0;
  for (const record of state.shares.values()) {
    if (record.projectId !== projectId || record.status !== "active") continue;
    record.status = "revoked";
    record.updatedAt = nowIso();
    revoked += 1;
  }
  return revoked;
}

/**
 * Phase P14 — revoke every active review link owned by a member for a
 * workspace's projects (mirror of the Supabase ws_revoke_member_shares RPC).
 * Used when a member is removed or downgraded to viewer: their public links
 * must stop resolving immediately — not just their ability to manage them.
 */
export function revokeMemberSharesForWorkspace(
  state: MockShareState,
  workspaceId: string,
  userId: string,
): number {
  const projectIds = new Set<string>();
  const wsState = getMockWorkspaceState();
  for (const project of wsState.projects.values()) {
    if (project.workspaceId === workspaceId) projectIds.add(project.projectId);
  }
  let revoked = 0;
  for (const record of state.shares.values()) {
    if (
      record.ownerId === userId &&
      record.status === "active" &&
      projectIds.has(record.projectId)
    ) {
      record.status = "revoked";
      record.updatedAt = nowIso();
      revoked += 1;
    }
  }
  return revoked;
}

export function handleDeleteProjectShareData(
  state: MockShareState,
  token: string | null,
  projectId: string,
): { revokedShares: number; deletedComments: number } {
  const owner = requireOwner(token);
  let revokedShares = 0;
  let deletedComments = 0;
  for (const record of [...state.shares.values()]) {
    if (record.ownerId !== owner.id || record.projectId !== projectId) continue;
    if (record.status === "active") {
      record.status = "revoked";
      record.updatedAt = nowIso();
      revokedShares += 1;
    }
    const comments = state.comments.get(record.id) ?? [];
    deletedComments += comments.length;
    state.comments.delete(record.id);
    state.commentAttempts.delete(record.id);
    state.lastComment.delete(record.id);
  }
  return { revokedShares, deletedComments };
}

// ---------------------------------------------------------------------------
// Token generation (server-side)
// ---------------------------------------------------------------------------

function randomToken(): string {
  // 32 random bytes → base64url (256-bit entropy), same shape as the client
  // token util so a created token from either side validates identically.
  return randomBytes(32).toString("base64url");
}

export interface PublicShareInfo {
  shareId: string;
  projectId: string;
  projectName: string;
  feedbackEnabled: boolean;
  requireName: boolean;
}

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — mock cloud backend (DEV/TEST ONLY)
//
// In-memory stand-in for the Supabase backend, exposed through Next.js API
// routes so the full feature (auth, sync, conflicts, shared libraries,
// invitations) is exercisable end-to-end without credentials. State lives in
// the dev-server process, so two browser contexts hitting the same dev
// server share one "cloud" — that is what makes cross-device e2e possible.
//
// Security posture mirrors the real backend:
//   - bearer sessions; every data endpoint requires a valid token
//   - ownership checks before every read/write (like RLS)
//   - password hashes, never plaintext
//   - normalized lowercase emails; invitations matched by recipient email
//   - rate limiting on auth + invitation creation
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from "node:crypto";
import {
  encodeSyncCursor,
  isRecordAfterCursor,
  maxPagePosition,
  parseSyncCursor,
} from "../sync-cursor";
import type {
  CloudLibraryInvitation,
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudPushTombstone,
  CloudSharedLibrary,
  SharedLibraryRole,
} from "../types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface MockUser {
  id: string;
  email: string;
  passwordHash: string;
}

interface MockLibrary {
  record: CloudSharedLibrary;
  blockIds: string[];
  /** Includes "owner" (the owner is never listed as a member). */
  members: Map<string, SharedLibraryRole | "owner">;
}

export interface MockCloudState {
  users: Map<string, MockUser>; // email -> user
  sessions: Map<string, string>; // token -> userId
  blocks: Map<string, CloudMyBlockPayload>; // cloud id -> payload (owner = current session user)
  blockOwners: Map<string, string>; // cloud id -> userId
  collections: Map<string, CloudMyBlockCollectionPayload>;
  collectionOwners: Map<string, string>;
  libraries: Map<string, MockLibrary>;
  invitations: Map<string, CloudLibraryInvitation>;
  authAttempts: Map<string, number[]>; // email -> timestamps
  inviteAttempts: Map<string, number[]>; // libraryId -> timestamps
}

export function createMockCloudState(): MockCloudState {
  return {
    users: new Map(),
    sessions: new Map(),
    blocks: new Map(),
    blockOwners: new Map(),
    collections: new Map(),
    collectionOwners: new Map(),
    libraries: new Map(),
    invitations: new Map(),
    authAttempts: new Map(),
    inviteAttempts: new Map(),
  };
}

// The mock cloud lives on globalThis (NOT a module-local variable): in Next.js
// dev, every route handler is its own webpack bundle, so a module-level
// singleton would be duplicated per route — sign-up sessions and synced blocks
// written through /api/cloud/[...path] would be invisible to other routes
// (e.g. /api/publish/vercel/*). globalThis is shared by every route bundle in
// the dev-server process, which is what makes cross-route + cross-device e2e
// possible. (Module-local state still works for tests that import the module
// directly — the first getMockCloudState() call installs the global and all
// subsequent callers see the same instance.)
const MOCK_CLOUD_GLOBAL_KEY = "buildora.mockCloudState.v1";

export function getMockCloudState(): MockCloudState {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[MOCK_CLOUD_GLOBAL_KEY];
  if (existing) return existing as MockCloudState;
  const fresh = createMockCloudState();
  g[MOCK_CLOUD_GLOBAL_KEY] = fresh;
  return fresh;
}

export function resetMockCloudState(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g[MOCK_CLOUD_GLOBAL_KEY] = createMockCloudState();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class MockCloudError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireSession(state: MockCloudState, token: string | null): MockUser {
  if (!token) throw new MockCloudError(401, "UNAUTHORIZED", "Sign in to continue.");
  const userId = state.sessions.get(token);
  if (!userId) throw new MockCloudError(401, "SESSION_EXPIRED", "Your session ended. Sign in again.");
  const user = [...state.users.values()].find((u) => u.id === userId);
  if (!user) throw new MockCloudError(401, "SESSION_EXPIRED", "Your session ended. Sign in again.");
  return user;
}

// ---------------------------------------------------------------------------
// Auth handlers
// ---------------------------------------------------------------------------

export function handleSignup(
  state: MockCloudState,
  body: { email?: unknown; password?: unknown },
): { user: { id: string; email: string }; token: string } {
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new MockCloudError(400, "INVALID_EMAIL", "Please enter a valid email address.");
  }
  if (password.length < 6) {
    throw new MockCloudError(400, "WEAK_PASSWORD", "Your password needs to be at least 6 characters.");
  }
  if (rateLimited(state.authAttempts, email, 10, 60_000)) {
    throw new MockCloudError(429, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
  }
  if (state.users.has(email)) {
    throw new MockCloudError(409, "EMAIL_TAKEN", "That email is already in use.");
  }
  const user: MockUser = {
    id: `user-${randomUUID()}`,
    email,
    passwordHash: sha256(password),
  };
  state.users.set(email, user);
  const token = `mock-${randomUUID()}`;
  state.sessions.set(token, user.id);
  return { user: { id: user.id, email }, token };
}

export function handleSignin(
  state: MockCloudState,
  body: { email?: unknown; password?: unknown },
): { user: { id: string; email: string }; token: string } {
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const password = typeof body.password === "string" ? body.password : "";
  if (rateLimited(state.authAttempts, email, 10, 60_000)) {
    throw new MockCloudError(429, "RATE_LIMITED", "Too many attempts. Please wait a moment.");
  }
  const user = state.users.get(email);
  // Constant-ish failure: same generic error whether the email exists or not.
  if (!user || user.passwordHash !== sha256(password)) {
    throw new MockCloudError(401, "INVALID_CREDENTIALS", "That email or password isn't right.");
  }
  const token = `mock-${randomUUID()}`;
  state.sessions.set(token, user.id);
  return { user: { id: user.id, email }, token };
}

export function handleSignout(state: MockCloudState, token: string | null): void {
  if (token) state.sessions.delete(token);
}

export function handleResetPassword(
  state: MockCloudState,
  body: { email?: unknown },
): void {
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  // Mock: no email delivery. Always "succeeds" so account existence is not
  // revealed; a reset code is simulated in-memory (not delivered).
  void email;
  void state;
}

// ---------------------------------------------------------------------------
// Sync handlers
// ---------------------------------------------------------------------------

export function handlePushBlockBatch(
  state: MockCloudState,
  token: string | null,
  blocks: CloudMyBlockPayload[],
): void {
  const user = requireSession(state, token);
  for (const block of blocks) {
    state.blocks.set(block.id, { ...block });
    state.blockOwners.set(block.id, user.id);
  }
}

export function handlePushCollectionBatch(
  state: MockCloudState,
  token: string | null,
  collections: CloudMyBlockCollectionPayload[],
): void {
  const user = requireSession(state, token);
  for (const collection of collections) {
    state.collections.set(collection.id, { ...collection });
    state.collectionOwners.set(collection.id, user.id);
  }
}

export function handlePushTombstones(
  state: MockCloudState,
  token: string | null,
  items: CloudPushTombstone[],
): void {
  const user = requireSession(state, token);
  for (const item of items) {
    if (item.entityType === "myBlock") {
      const record = state.blocks.get(item.id);
      if (record && state.blockOwners.get(item.id) === user.id) {
        state.blocks.set(item.id, { ...record, deletedAt: nowIso(), updatedAt: nowIso() });
      }
    } else {
      const record = state.collections.get(item.id);
      if (record && state.collectionOwners.get(item.id) === user.id) {
        state.collections.set(item.id, { ...record, deletedAt: nowIso(), updatedAt: nowIso() });
      }
    }
  }
}

export function handleFetchChanges(
  state: MockCloudState,
  token: string | null,
  after: string | null,
  limit: number,
): { cursor: string; hasMore: boolean; blocks: CloudMyBlockPayload[]; collections: CloudMyBlockCollectionPayload[] } {
  const user = requireSession(state, token);
  // Deterministic union pagination (same semantics as the in-memory and
  // Supabase providers): one (updatedAt, id) ordering across blocks AND
  // collections, strict id tie-breaker, cursor never ahead of the observed
  // page. Tombstones (deletedAt set) are deltas too.
  const position = parseSyncCursor(after);
  const changed = [
    ...state.blocks.values()
      .filter((b) => state.blockOwners.get(b.id) === user.id)
      .map((block) => ({ kind: "block" as const, record: block })),
    ...state.collections.values()
      .filter((c) => state.collectionOwners.get(c.id) === user.id)
      .map((collection) => ({ kind: "collection" as const, record: collection })),
  ]
    .filter((item) =>
      isRecordAfterCursor(item.record.updatedAt, item.record.id, position),
    )
    .sort(
      (a, b) =>
        a.record.updatedAt.localeCompare(b.record.updatedAt) ||
        a.record.id.localeCompare(b.record.id),
    );
  const page = changed.slice(0, limit);
  const blocks = page.filter((i) => i.kind === "block").map((i) => i.record);
  const collections = page.filter((i) => i.kind === "collection").map((i) => i.record);
  const last = maxPagePosition(
    page.map((i) => ({ ts: i.record.updatedAt, id: i.record.id })),
  );
  return {
    blocks,
    collections,
    cursor: last ? encodeSyncCursor(last.ts, last.id) : (after ?? ""),
    hasMore: page.length < changed.length,
  };
}

// ---------------------------------------------------------------------------
// Shared library handlers (ownership + membership enforced like RLS)
// ---------------------------------------------------------------------------

function requireLibrary(state: MockCloudState, id: string): MockLibrary {
  const library = state.libraries.get(id);
  if (!library || library.record.deletedAt) {
    throw new MockCloudError(404, "NOT_FOUND", "That shared library is unavailable.");
  }
  return library;
}

function requireMemberAccess(state: MockCloudState, user: MockUser, library: MockLibrary): void {
  if (library.record.ownerId !== user.id && !library.members.has(user.id)) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "You don't have access to that shared library.");
  }
}

function libraryView(
  library: MockLibrary,
  viewerId: string,
): CloudSharedLibrary {
  return {
    ...library.record,
    memberRole: library.record.ownerId === viewerId ? "owner" : ((library.members.get(viewerId) ?? "viewer") as SharedLibraryRole),
    memberCount: library.members.size,
    blockCount: library.blockIds.length,
  };
}

export function handleCreateLibrary(
  state: MockCloudState,
  token: string | null,
  input: { name?: unknown; description?: unknown },
): CloudSharedLibrary {
  const user = requireSession(state, token);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new MockCloudError(400, "INVALID_NAME", "Give your shared library a name.");
  const description =
    typeof input.description === "string" ? input.description.trim().slice(0, 200) : undefined;
  const now = nowIso();
  const record: CloudSharedLibrary = {
    id: `lib-${randomUUID()}`,
    ownerId: user.id,
    name,
    ...(description ? { description } : {}),
    createdAt: now,
    updatedAt: now,
    memberRole: "owner",
    memberCount: 1,
    blockCount: 0,
  };
  state.libraries.set(record.id, {
    record,
    blockIds: [],
    members: new Map([[user.id, "owner"]]),
  });
  return record;
}

export function handleListLibraries(
  state: MockCloudState,
  token: string | null,
): { owned: CloudSharedLibrary[]; shared: CloudSharedLibrary[] } {
  const user = requireSession(state, token);
  const owned: CloudSharedLibrary[] = [];
  const shared: CloudSharedLibrary[] = [];
  for (const library of state.libraries.values()) {
    if (library.record.deletedAt) continue;
    if (library.record.ownerId === user.id) {
      owned.push(libraryView(library, user.id));
    } else if (library.members.has(user.id)) {
      shared.push(libraryView(library, user.id));
    }
  }
  return { owned, shared };
}

export function handleGetLibrary(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
): { library: CloudSharedLibrary; blocks: { id: string; libraryId: string; block: CloudMyBlockPayload }[] } | null {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  requireMemberAccess(state, user, library);
  const blocks = library.blockIds
    .map((blockId) => state.blocks.get(blockId))
    .filter((b): b is CloudMyBlockPayload => !!b && !b.deletedAt)
    .map((b) => ({ id: b.id, libraryId, block: { ...b } }));
  return { library: libraryView(library, user.id), blocks };
}

export function handleUpdateLibrary(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
  patch: { name?: unknown; description?: unknown },
): CloudSharedLibrary {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can edit this shared library.");
  }
  if (patch.name !== undefined && typeof patch.name === "string") {
    const name = patch.name.trim().slice(0, 80);
    if (!name) throw new MockCloudError(400, "INVALID_NAME", "Give your shared library a name.");
    library.record = { ...library.record, name };
  }
  if (patch.description !== undefined) {
    const description =
      typeof patch.description === "string" ? patch.description.trim().slice(0, 200) : undefined;
    library.record = { ...library.record, ...(description ? { description } : {}) };
  }
  library.record = { ...library.record, updatedAt: nowIso() };
  return libraryView(library, user.id);
}

export function handleDeleteLibrary(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
): void {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can delete this shared library.");
  }
  library.record = { ...library.record, deletedAt: nowIso(), updatedAt: nowIso() };
}

export function handleAddBlocksToLibrary(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
  blockIds: string[],
): void {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can add pieces to this shared library.");
  }
  for (const blockId of blockIds) {
    // Only the owner's own validated blocks may be added.
    if (state.blockOwners.get(blockId) !== user.id) continue;
    if (!library.blockIds.includes(blockId)) library.blockIds.push(blockId);
  }
  library.record = { ...library.record, updatedAt: nowIso() };
}

export function handleRemoveBlockFromLibrary(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
  blockId: string,
): void {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can remove pieces from this shared library.");
  }
  library.blockIds = library.blockIds.filter((id) => id !== blockId);
  library.record = { ...library.record, updatedAt: nowIso() };
}

export function handleFetchSharedBlock(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
  blockId: string,
): CloudMyBlockPayload {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  requireMemberAccess(state, user, library);
  if (!library.blockIds.includes(blockId)) {
    throw new MockCloudError(404, "NOT_FOUND", "That piece isn't in this shared library.");
  }
  const block = state.blocks.get(blockId);
  if (!block || block.deletedAt) {
    throw new MockCloudError(404, "NOT_FOUND", "That shared piece is no longer available.");
  }
  return { ...block };
}

export function handleListLibraryMembers(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
): Array<{ userId: string; email: string; role: SharedLibraryRole }> {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can see members.");
  }
  const members: Array<{ userId: string; email: string; role: SharedLibraryRole }> = [];
  for (const [userId, role] of library.members) {
    // Mirrors the real backend: the owner lives on the library, not in the
    // member list (their row is rendered from library.ownerId in the UI).
    if (userId === library.record.ownerId) continue;
    const memberUser = [...state.users.values()].find((u) => u.id === userId);
    members.push({
      userId,
      email: memberUser?.email ?? "",
      role: role === "editor" ? "editor" : "viewer",
    });
  }
  return members;
}

export function handleInviteMember(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
  input: { email?: unknown; role?: unknown },
): CloudLibraryInvitation {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can invite people.");
  }
  if (rateLimited(state.inviteAttempts, libraryId, 20, 60_000)) {
    throw new MockCloudError(429, "RATE_LIMITED", "Too many invitations. Try again shortly.");
  }
  const email = normalizeEmail(typeof input.email === "string" ? input.email : "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new MockCloudError(400, "INVALID_EMAIL", "Please enter a valid email address.");
  }
  const role: SharedLibraryRole = input.role === "editor" ? "editor" : "viewer";
  const now = new Date();
  const invitation: CloudLibraryInvitation = {
    id: `inv-${randomUUID()}`,
    libraryId,
    libraryName: library.record.name,
    recipientEmail: email,
    role,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  };
  state.invitations.set(invitation.id, invitation);
  return invitation;
}

export function handleListInvitations(
  state: MockCloudState,
  token: string | null,
): CloudLibraryInvitation[] {
  const user = requireSession(state, token);
  return [...state.invitations.values()].filter(
    (i) => i.recipientEmail === user.email && i.status === "pending" && i.expiresAt > nowIso(),
  );
}

export function handleListLibraryInvitations(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
): CloudLibraryInvitation[] {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can see pending invitations.");
  }
  return [...state.invitations.values()].filter(
    (i) => i.libraryId === libraryId && i.status === "pending" && i.expiresAt > nowIso(),
  );
}

export function handleAcceptInvitation(
  state: MockCloudState,
  token: string | null,
  invitationId: string,
): void {
  const user = requireSession(state, token);
  const invitation = state.invitations.get(invitationId);
  if (!invitation || invitation.status !== "pending") {
    throw new MockCloudError(400, "INVITE_INVALID", "That invitation is no longer valid.");
  }
  if (invitation.expiresAt <= nowIso()) {
    throw new MockCloudError(400, "INVITE_EXPIRED", "That invitation has expired.");
  }
  if (invitation.recipientEmail !== user.email) {
    throw new MockCloudError(400, "INVITE_INVALID", "That invitation isn't for this account.");
  }
  const library = state.libraries.get(invitation.libraryId);
  if (!library || library.record.deletedAt) {
    throw new MockCloudError(400, "INVITE_INVALID", "That shared library no longer exists.");
  }
  library.members.set(user.id, invitation.role);
  invitation.status = "accepted";
  invitation.acceptedAt = nowIso();
}

export function handleRevokeInvitation(
  state: MockCloudState,
  token: string | null,
  invitationId: string,
): void {
  const user = requireSession(state, token);
  const invitation = state.invitations.get(invitationId);
  if (!invitation) return;
  const library = state.libraries.get(invitation.libraryId);
  if (!library || library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can revoke invitations.");
  }
  invitation.status = "revoked";
}

export function handleRevokeMember(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
  memberUserId: string,
): void {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId !== user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Only the owner can remove members.");
  }
  library.members.delete(memberUserId);
}

export function handleLeaveLibrary(
  state: MockCloudState,
  token: string | null,
  libraryId: string,
): void {
  const user = requireSession(state, token);
  const library = requireLibrary(state, libraryId);
  if (library.record.ownerId === user.id) {
    throw new MockCloudError(403, "PERMISSION_DENIED", "Owners can't leave — delete the library instead.");
  }
  library.members.delete(user.id);
}

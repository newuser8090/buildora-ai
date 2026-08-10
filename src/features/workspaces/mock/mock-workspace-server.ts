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
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import {
  EDIT_LEASE_DURATION_MS,
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS_PER_WORKSPACE,
  MAX_WORKSPACE_NAME_LENGTH,
  WORKSPACE_PROJECT_MAX_BYTES,
} from "../constants";
import type {
  LeaseAcquireResult,
  ProjectEditLease,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
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

export interface MockWorkspaceState {
  workspaces: Map<string, MockWorkspaceRecord>;
  invitations: Map<string, WorkspaceInvitation>;
  projects: Map<string, MockWorkspaceProject>; // `${workspaceId}:${projectId}`
  leases: Map<string, ProjectEditLease>; // `${workspaceId}:${projectId}` -> lease
  inviteAttempts: Map<string, number[]>; // workspaceId -> timestamps
}

export function createMockWorkspaceState(): MockWorkspaceState {
  return {
    workspaces: new Map(),
    invitations: new Map(),
    projects: new Map(),
    leases: new Map(),
    inviteAttempts: new Map(),
  };
}

const MOCK_WORKSPACE_GLOBAL_KEY = "buildora.mockWorkspaceState.v1";

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
  // Cascade: projects, invitations, leases.
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
  // A role change to viewer invalidates any lease the member holds.
  if (role === "viewer") {
    for (const lease of [...state.leases.values()]) {
      if (lease.workspaceId === workspaceId && lease.userId === memberUserId) {
        state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
      }
    }
  }
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
  // Immediate access loss: drop any lease the removed member held.
  for (const lease of [...state.leases.values()]) {
    if (lease.workspaceId === workspaceId && lease.userId === memberUserId) {
      state.leases.delete(projectKey(lease.workspaceId, lease.projectId));
    }
  }
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
  input: { projectId?: unknown; project?: unknown },
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
  project.payload = payload;
  project.name = name;
  project.revision += 1;
  project.updatedAt = nowIso();
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
  state.projects.delete(projectKey(workspaceId, projectId));
  // Leases are scoped by (workspace, project) — never touch another
  // workspace's same-id project.
  state.leases.delete(projectKey(workspaceId, projectId));
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
  return toProjectSummary(project);
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

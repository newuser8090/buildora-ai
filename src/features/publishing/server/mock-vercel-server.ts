// ---------------------------------------------------------------------------
// Publishing — Mock Vercel API (DEV/TEST ONLY, server-side)
//
// In-memory stand-in for api.vercel.com, used by the publish route handlers
// when no VERCEL_API_TOKEN is configured and the environment is development
// (or a test forces mock mode). Same pattern as the Phase P6 mock cloud
// backend: state lives in the dev-server process so E2E browser contexts
// share one "provider".
//
// Mirrors the real contract the HttpVercelApiClient uses:
//   - projects keyed by deterministic name
//   - deployments transition QUEUED → BUILDING → READY on timers
//   - production alias re-pointed by promote (rollback)
//   - domains attach with DNS instructions and auto-verify after a short
//     delay (DNS propagation simulation)
//   - bearer/owner checks on every management call (like RLS)
// ---------------------------------------------------------------------------

import type {
  AttachDomainResult,
  DomainStatusResult,
} from "../domain/types";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface MockVercelFile {
  path: string;
  content: string;
  encoding?: string;
}

export interface MockVercelDeployment {
  id: string;
  projectId: string;
  projectName: string;
  ownerUserId: string;
  files: MockVercelFile[];
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED";
  target: "production" | "preview";
  createdAt: number;
  buildStartedAt?: number;
  readyAt?: number;
  url: string;
  previewUrl: string;
  errorSummary?: string;
  fileCount: number;
  totalBytes: number;
  idempotencyKey?: string;
}

export interface MockVercelDomain {
  name: string;
  ownerUserId: string;
  projectId: string;
  attachedAt: number;
  verified: boolean;
  verifiedAt?: number;
}

export interface MockVercelProject {
  id: string;
  name: string;
  ownerUserId: string;
  productionDeploymentId?: string;
  domains: Map<string, MockVercelDomain>;
}

export interface MockVercelState {
  projects: Map<string, MockVercelProject>; // by name
  deployments: Map<string, MockVercelDeployment>; // by id
  /** Deterministic build/verify delays in ms. */
  buildDelayMs: number;
  verifyDelayMs: number;
  now: () => number;
}

export function createMockVercelState(options?: {
  buildDelayMs?: number;
  verifyDelayMs?: number;
  now?: () => number;
}): MockVercelState {
  return {
    projects: new Map(),
    deployments: new Map(),
    buildDelayMs: options?.buildDelayMs ?? 1600,
    verifyDelayMs: options?.verifyDelayMs ?? 1400,
    now: options?.now ?? (() => Date.now()),
  };
}

// The mock Vercel provider lives on globalThis (NOT a module-local variable):
// in Next.js dev, every route handler is its own webpack bundle, so a
// module-level singleton would be duplicated per route — a deployment created
// by /api/publish/vercel/deploy would be invisible to the status/rollback/
// domain routes that poll and manage it. globalThis is shared by every route
// bundle in the dev-server process, so one provider state serves the whole
// publish flow (mirroring the real provider's remote state).
const MOCK_VERCEL_GLOBAL_KEY = "buildora.mockVercelState.v1";

export function getMockVercelState(): MockVercelState {
  const g = globalThis as unknown as Record<string, unknown>;
  const existing = g[MOCK_VERCEL_GLOBAL_KEY];
  if (existing) return existing as MockVercelState;
  const fresh = createMockVercelState();
  g[MOCK_VERCEL_GLOBAL_KEY] = fresh;
  return fresh;
}

export function resetMockVercelState(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g[MOCK_VERCEL_GLOBAL_KEY] = createMockVercelState();
}

/** Test hook — deterministic clock for unit tests. */
export function setMockVercelClockForTests(now: () => number): void {
  const s = getMockVercelState();
  s.now = now;
}

/** Test hook — seed a project (used by unit tests). */
export function _seedMockVercelProject(project: MockVercelProject): void {
  getMockVercelState().projects.set(project.name, project);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MockVercelError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireOwner(
  s: MockVercelState,
  ownerUserId: string | null | undefined,
  actualOwner: string,
  message = "You don't have access to this deployment.",
): void {
  if (!ownerUserId || ownerUserId !== actualOwner) {
    throw new MockVercelError(403, "PERMISSION_DENIED", message);
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** Ensure a project exists for the deterministic name; returns its id. */
export function mockEnsureProject(
  ownerUserId: string,
  name: string,
): { projectId: string; projectName: string } {
  const s = getMockVercelState();
  const existing = s.projects.get(name);
  if (existing) {
    requireOwner(s, ownerUserId, existing.ownerUserId, "You don't own this project.");
    return { projectId: existing.id, projectName: existing.name };
  }
  const project: MockVercelProject = {
    id: makeId("prj"),
    name,
    ownerUserId,
    domains: new Map(),
  };
  s.projects.set(name, project);
  return { projectId: project.id, projectName: project.name };
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export interface MockCreateDeploymentInput {
  ownerUserId: string;
  projectId: string;
  projectName: string;
  files: MockVercelFile[];
  target: "production" | "preview";
  idempotencyKey?: string;
}

export function mockCreateDeployment(
  input: MockCreateDeploymentInput,
): {
  id: string;
  url: string;
  readyState: string;
  projectId: string;
  projectName: string;
} {
  const s = getMockVercelState();
  const project = s.projects.get(input.projectName);
  if (!project) throw new MockVercelError(404, "PROJECT_NOT_FOUND", "Project not found.");
  requireOwner(s, input.ownerUserId, project.ownerUserId);

  const id = makeId("dpl");
  const now = s.now();
  const url = `https://${input.projectName}-${id.slice(4, 10)}.vercel.app`;
  const deployment: MockVercelDeployment = {
    id,
    projectId: input.projectId,
    projectName: input.projectName,
    ownerUserId: input.ownerUserId,
    files: input.files,
    readyState: "QUEUED",
    target: input.target,
    createdAt: now,
    url,
    previewUrl: url,
    fileCount: input.files.length,
    totalBytes: input.files.reduce(
      (sum, f) => sum + (f.encoding === "base64" ? Math.ceil((f.content.length * 3) / 4) : f.content.length),
      0,
    ),
    idempotencyKey: input.idempotencyKey,
  };
  s.deployments.set(id, deployment);

  // Deterministic lifecycle: QUEUED → BUILDING → READY.
  setTimeout(() => {
    const current = s.deployments.get(id);
    if (current && current.readyState === "QUEUED") {
      current.readyState = "BUILDING";
      current.buildStartedAt = s.now();
    }
  }, Math.round(s.buildDelayMs / 2));
  setTimeout(() => {
    const current = s.deployments.get(id);
    if (current && (current.readyState === "BUILDING" || current.readyState === "QUEUED")) {
      current.readyState = "READY";
      current.readyAt = s.now();
      if (input.target === "production") {
        project.productionDeploymentId = id;
      }
    }
  }, s.buildDelayMs);

  return {
    id,
    url,
    readyState: "QUEUED",
    projectId: project.id,
    projectName: project.name,
  };
}

/** Fetch a deployment as the route layer sees it. */
export function mockGetDeployment(
  ownerUserId: string,
  deploymentId: string,
): {
  id: string;
  projectId: string;
  projectName: string;
  url: string;
  previewUrl: string;
  readyState: string;
  productionUrl?: string;
  buildStartedAt?: string;
  buildCompletedAt?: string;
  errorSummary?: string;
} {
  const s = getMockVercelState();
  const d = s.deployments.get(deploymentId);
  if (!d) throw new MockVercelError(404, "DEPLOYMENT_NOT_FOUND", "Deployment not found.");
  requireOwner(s, ownerUserId, d.ownerUserId);

  const project = s.projects.get(d.projectName);
  const productionUrl =
    project && project.productionDeploymentId === d.id
      ? (project.domains.size > 0
          ? `https://${[...project.domains.values()].find((dm) => dm.verified)?.name ?? [...project.domains.values()][0].name}`
          : d.url)
      : undefined;

  return {
    id: d.id,
    projectId: d.projectId,
    projectName: d.projectName,
    url: d.url,
    previewUrl: d.previewUrl,
    readyState: d.readyState,
    productionUrl,
    buildStartedAt: d.buildStartedAt ? new Date(d.buildStartedAt).toISOString() : undefined,
    buildCompletedAt: d.readyAt ? new Date(d.readyAt).toISOString() : undefined,
    errorSummary: d.errorSummary,
  };
}

export function mockListDeployments(
  ownerUserId: string,
  projectName: string,
): Array<{ id: string; url: string; readyState: string }> {
  const s = getMockVercelState();
  const project = s.projects.get(projectName);
  if (!project) return [];
  return [...s.deployments.values()]
    .filter((d) => d.projectName === projectName)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((d) => ({ id: d.id, url: d.url, readyState: d.readyState }));
}

export function mockCancelDeployment(
  ownerUserId: string,
  deploymentId: string,
): { id: string; readyState: string } {
  const s = getMockVercelState();
  const d = s.deployments.get(deploymentId);
  if (!d) throw new MockVercelError(404, "DEPLOYMENT_NOT_FOUND", "Deployment not found.");
  requireOwner(s, ownerUserId, d.ownerUserId);
  if (d.readyState === "READY" || d.readyState === "CANCELED") {
    throw new MockVercelError(400, "CANNOT_CANCEL", "This deployment can no longer be cancelled.");
  }
  d.readyState = "CANCELED";
  return { id: d.id, readyState: d.readyState };
}

export function mockDeleteDeployment(ownerUserId: string, deploymentId: string): void {
  const s = getMockVercelState();
  const d = s.deployments.get(deploymentId);
  if (!d) throw new MockVercelError(404, "DEPLOYMENT_NOT_FOUND", "Deployment not found.");
  requireOwner(s, ownerUserId, d.ownerUserId);
  s.deployments.delete(deploymentId);
}

/** Rollback: re-point the production alias to the target deployment. */
export function mockPromoteDeployment(
  ownerUserId: string,
  projectId: string,
  deploymentId: string,
): { url: string; readyState: string; activatedAt: string } {
  const s = getMockVercelState();
  const project = [...s.projects.values()].find((p) => p.id === projectId);
  if (!project) throw new MockVercelError(404, "PROJECT_NOT_FOUND", "Project not found.");
  requireOwner(s, ownerUserId, project.ownerUserId);
  const d = s.deployments.get(deploymentId);
  if (!d || d.projectId !== projectId) {
    throw new MockVercelError(404, "DEPLOYMENT_NOT_FOUND", "Deployment not found.");
  }
  if (d.readyState !== "READY") {
    throw new MockVercelError(400, "NOT_READY", "Only a live deployment can be restored.");
  }
  project.productionDeploymentId = d.id;
  const activatedAt = new Date(s.now()).toISOString();
  return { url: d.url, readyState: d.readyState, activatedAt };
}

/** Delete a provider project and all of its deployments/domains. */
export function mockDeleteProject(ownerUserId: string, projectName: string): void {
  const s = getMockVercelState();
  const project = s.projects.get(projectName);
  if (!project) return; // already gone — idempotent
  requireOwner(s, ownerUserId, project.ownerUserId);
  for (const [id, d] of s.deployments) {
    if (d.projectName === projectName) s.deployments.delete(id);
  }
  s.projects.delete(projectName);
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

const VERIFY_TXT_VALUE = "vc-domain-verify=buildora";

export function mockAttachDomain(
  ownerUserId: string,
  projectId: string,
  domain: string,
): AttachDomainResult {
  const s = getMockVercelState();
  const project = [...s.projects.values()].find((p) => p.id === projectId);
  if (!project) throw new MockVercelError(404, "PROJECT_NOT_FOUND", "Project not found.");
  requireOwner(s, ownerUserId, project.ownerUserId);

  // Duplicate detection (also used for "already in use").
  const existing = project.domains.get(domain);
  if (existing) {
    throw new MockVercelError(409, "DOMAIN_ALREADY_IN_USE", "That domain is already connected.");
  }

  const record: MockVercelDomain = {
    name: domain,
    ownerUserId,
    projectId,
    attachedAt: s.now(),
    verified: false,
  };
  project.domains.set(domain, record);
  scheduleDomainVerify(domain, projectId);

  return {
    domain,
    status: "pending",
    httpsReady: false,
    verification: [
      {
        type: "CNAME",
        name: domain === "www.example.com" ? "www" : domain,
        value: "cname.vercel-dns.com.",
        purpose: "Point this name at your site.",
      },
      {
        type: "TXT",
        name: "_vercel",
        value: VERIFY_TXT_VALUE,
        purpose: "Prove you own this domain.",
      },
    ],
  };
}

function scheduleDomainVerify(domain: string, projectId: string): void {
  const s = getMockVercelState();
  setTimeout(() => {
    const project = [...s.projects.values()].find((p) => p.id === projectId);
    const record = project?.domains.get(domain);
    if (record && !record.verified) {
      record.verified = true;
      record.verifiedAt = s.now();
    }
  }, s.verifyDelayMs);
}

export function mockGetDomainStatus(
  ownerUserId: string,
  projectId: string,
  domain: string,
): DomainStatusResult {
  const s = getMockVercelState();
  const project = [...s.projects.values()].find((p) => p.id === projectId);
  if (!project) throw new MockVercelError(404, "PROJECT_NOT_FOUND", "Project not found.");
  requireOwner(s, ownerUserId, project.ownerUserId);
  const record = project.domains.get(domain);
  if (!record) throw new MockVercelError(404, "DOMAIN_NOT_FOUND", "Domain not found.");

  return {
    domain,
    status: record.verified ? "verified" : "pending",
    httpsReady: record.verified,
    verification: [
      {
        type: "CNAME",
        name: domain,
        value: "cname.vercel-dns.com.",
        purpose: "Point this name at your site.",
      },
    ],
    ...(record.verified ? {} : { providerCode: "PENDING_DNS" }),
  };
}

export function mockListDomains(
  ownerUserId: string,
  projectId: string,
): Array<{ domain: string; status: string; httpsReady: boolean }> {
  const s = getMockVercelState();
  const project = [...s.projects.values()].find((p) => p.id === projectId);
  if (!project) return [];
  requireOwner(s, ownerUserId, project.ownerUserId);
  return [...project.domains.values()].map((d) => ({
    domain: d.name,
    status: d.verified ? "verified" : "pending",
    httpsReady: d.verified,
  }));
}

export function mockRemoveDomain(
  ownerUserId: string,
  projectId: string,
  domain: string,
): void {
  const s = getMockVercelState();
  const project = [...s.projects.values()].find((p) => p.id === projectId);
  if (!project) throw new MockVercelError(404, "PROJECT_NOT_FOUND", "Project not found.");
  requireOwner(s, ownerUserId, project.ownerUserId);
  if (!project.domains.has(domain)) {
    throw new MockVercelError(404, "DOMAIN_NOT_FOUND", "Domain not found.");
  }
  project.domains.delete(domain);
}

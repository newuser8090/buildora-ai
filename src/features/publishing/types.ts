// ---------------------------------------------------------------------------
// Publishing — types (Phase P7 + P8)
//
// Deployment records live OUTSIDE ProjectSchema: they are operational
// history, never exported/imported with the project, never part of undo
// history. Persisted in the IndexedDB "deployments" store.
// No tokens, secret headers, or access credentials are ever stored here.
// ---------------------------------------------------------------------------

import type { PublishErrorCode } from "./errors";
import type { PublishingProviderCapabilities } from "./capabilities";

export type DeploymentStatus =
  | "queued"
  | "building"
  | "uploading"
  | "live"
  | "failed"
  | "cancelled";

export type PublishStage =
  | "checking"
  | "preparing"
  | "building"
  | "publishing"
  | "live";

export interface DeploymentRecord {
  id: string;
  projectId: string;
  providerId: string;
  status: DeploymentStatus;
  createdAt: string;
  completedAt?: string;
  /** Public/ready URL (mock: demo URL that never claims public internet). */
  url?: string;
  /** Editor revision at publish time. */
  projectRevision: number;
  /** Deterministic hash of the generated export files. */
  exportHash: string;
  /** Deterministic hash of the project content (cheap change detection). */
  contentHash: string;
  errorCode?: string;
  previousDeploymentId?: string;
  /** Set when this deployment became (or was rolled back to) the active one. */
  activatedAt?: string;

  // ---- Phase P8 — real production provider fields (all optional) ----
  /** Buildora user id that owns this deployment (set server-side). */
  ownerUserId?: string;
  /** Provider deployment id (e.g. dpl_...). */
  providerDeploymentId?: string;
  /** Provider project id (e.g. prj_...). */
  providerProjectId?: string;
  /** Provider project name (e.g. buildora-<projectId>). */
  providerProjectName?: string;
  /** Raw provider state (e.g. "READY") — advanced detail only. */
  providerState?: string;
  /** Immutable provider deployment URL. */
  deploymentUrl?: string;
  /** The public/current URL (production alias or verified custom domain). */
  productionUrl?: string;
  /** Separate preview URL when the provider supports preview deployments. */
  previewUrl?: string;
  /** Custom domain ids attached to this deployment. */
  domainIds?: string[];
  buildStartedAt?: string;
  buildCompletedAt?: string;
  /** Provider error summary (sanitized) when the build failed. */
  providerErrorSummary?: string;
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

export interface PublishInput {
  projectId: string;
  /** A snapshot of the project — the provider must never receive a live ref. */
  projectSnapshot: unknown;
  deploymentId: string;
  /** Deterministic hash of the generated export (for the record). */
  exportHash: string;
  /** Deterministic hash of the project content (change detection). */
  contentHash: string;
  /** Idempotency guard key (projectId + exportHash). */
  idempotencyKey: string;
}

export interface PublishProgressEvent {
  stage: PublishStage;
  /** 0–1 fraction (deterministic; never faked beyond real work). */
  fraction: number;
  message: string;
}

export type PublishProgressListener = (event: PublishProgressEvent) => void;

export interface ProviderAvailability {
  available: boolean;
  /** Beginner-safe reason when unavailable. */
  reason?: string;
  /** True for dev/E2E-only providers (mock, mock Vercel API). */
  devOnly?: boolean;
  /** Provider capability summary (drives UI actions). */
  capabilities?: PublishingProviderCapabilities;
}

export interface PublishResult {
  ok: boolean;
  /** Final live/ready URL (mock: demo URL; local export: undefined). */
  url?: string;
  error?: {
    code: PublishErrorCode;
    message: string;
  };
  /**
   * Optional provider metadata to merge into the deployment record on
   * success (P8). The PublishService remains the only writer of records.
   */
  deploymentPatch?: Partial<DeploymentRecord>;
}

export interface PublishingProvider {
  id: string;
  label: string;
  description: string;
  /** What this provider can do — the UI derives actions from this. */
  readonly capabilities: PublishingProviderCapabilities;
  isAvailable(): Promise<ProviderAvailability>;
  publish(
    input: PublishInput,
    onProgress: PublishProgressListener,
    signal?: AbortSignal,
  ): Promise<PublishResult>;
  getDeployment(deploymentId: string): Promise<DeploymentRecord | null>;
  listDeployments(projectId: string): Promise<DeploymentRecord[]>;
  /**
   * Restore a previous deployment. Optional projectId lets provider
   * adapters that need the provider project id (e.g. Vercel promote) work.
   */
  rollback?(deploymentId: string, projectId?: string): Promise<DeploymentRecord>;
  /** Cancel a queued/building deployment where the provider supports it. */
  cancel?(deploymentId: string, projectId?: string): Promise<DeploymentRecord>;
  deleteDeployment?(deploymentId: string, projectId?: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Publish service result
// ---------------------------------------------------------------------------

export type PublishServiceResult =
  | { ok: true; deployment: DeploymentRecord }
  | { ok: false; error: { code: PublishErrorCode; message: string } };

export interface PublishRequest {
  project: import("@/types/project").Project;
  revision: number;
  providerId: string;
}

// ---------------------------------------------------------------------------
// Unpublished changes
// ---------------------------------------------------------------------------

export type PublishStatus =
  | "never-published"
  | "published"
  | "changes-unpublished";

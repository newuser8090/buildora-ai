// ---------------------------------------------------------------------------
// Publishing — types (Phase P7)
//
// Deployment records live OUTSIDE ProjectSchema: they are operational
// history, never exported/imported with the project, never part of undo
// history. Persisted in the IndexedDB "deployments" store.
// ---------------------------------------------------------------------------

import type { PublishErrorCode } from "./errors";

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
  /** For mock provider: a demo URL (never claims public internet). */
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
  /** True for dev/E2E-only providers (mock). */
  devOnly?: boolean;
}

export interface PublishResult {
  ok: boolean;
  /** Final live/ready URL (mock: demo URL; local export: undefined). */
  url?: string;
  error?: {
    code: PublishErrorCode;
    message: string;
  };
}

export interface PublishingProvider {
  id: string;
  label: string;
  description: string;
  isAvailable(): Promise<ProviderAvailability>;
  publish(
    input: PublishInput,
    onProgress: PublishProgressListener,
    signal?: AbortSignal,
  ): Promise<PublishResult>;
  getDeployment(deploymentId: string): Promise<DeploymentRecord | null>;
  listDeployments(projectId: string): Promise<DeploymentRecord[]>;
  rollback?(deploymentId: string): Promise<DeploymentRecord>;
  deleteDeployment?(deploymentId: string): Promise<void>;
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

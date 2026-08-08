// ---------------------------------------------------------------------------
// Publishing — Buildora publish API contract (Phase P8)
//
// Pure types shared by the client provider (VercelPublishingProvider) and the
// server route handlers. The wire envelope is `{ ok, data } | { ok, error }`
// matching the existing mock-cloud API conventions. Provider credentials are
// never part of any payload.
// ---------------------------------------------------------------------------

import type { DomainStatus } from "../domain/types";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
}

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------

export interface PublishFilePayload {
  /** Relative path within the export (validated server-side). */
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface DeployRequestPayload {
  projectId: string;
  /** Local deployment record id (deploy-...). */
  deploymentId: string;
  /** Deterministic export hash (hex). */
  exportHash: string;
  /** Deterministic project content hash (hex). */
  contentHash: string;
  /** Display name (sanitized/truncated server-side). */
  projectName: string;
  files: PublishFilePayload[];
  /** Idempotency guard key (projectId + exportHash). */
  idempotencyKey: string;
}

export interface DeployResponseData {
  providerDeploymentId: string;
  providerProjectId?: string;
  providerProjectName?: string;
  url: string;
  productionUrl?: string;
  previewUrl?: string;
  readyState: string;
  ownerUserId?: string;
  buildStartedAt?: string;
  buildCompletedAt?: string;
  /** True when the server returned an existing in-flight/identical deployment. */
  reused?: boolean;
}

// ---------------------------------------------------------------------------
// Deployment status / management
// ---------------------------------------------------------------------------

export interface DeploymentStatusData {
  providerDeploymentId: string;
  providerProjectId?: string;
  providerProjectName?: string;
  url: string;
  productionUrl?: string;
  previewUrl?: string;
  readyState: string;
  buildStartedAt?: string;
  buildCompletedAt?: string;
  errorSummary?: string;
}

export interface CancelDeploymentData {
  providerDeploymentId: string;
  readyState: string;
}

export interface RollbackDeploymentData {
  providerDeploymentId: string;
  readyState: string;
  url: string;
  activatedAt: string;
}

export interface DeploymentLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
}

export interface DeploymentLogsData {
  entries: DeploymentLogEntry[];
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export interface AttachDomainRequestPayload {
  projectId: string;
  domain: string;
}

export interface DomainWireResult {
  domain: string;
  status: DomainStatus;
  verification: import("../domain/types").DomainVerificationInstruction[];
  httpsReady: boolean;
}

export interface DomainStatusData extends DomainWireResult {
  providerCode?: string;
}

export interface ListDomainsData {
  domains: DomainWireResult[];
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export interface ProviderStatusData {
  providerId: string;
  available: boolean;
  devOnly?: boolean;
  reason?: string;
  configured: boolean;
  credentialsValid?: boolean;
}

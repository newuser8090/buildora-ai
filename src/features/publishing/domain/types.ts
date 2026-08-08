// ---------------------------------------------------------------------------
// Publishing — custom domains (Phase P8)
//
// Custom domains are deployment infrastructure, not site content. They are
// stored OUTSIDE ProjectSchema in the IndexedDB "deploymentDomains" store;
// the hosting provider is the remote source of truth and this record is the
// local product history/cache. No DNS credentials are ever accepted.
// ---------------------------------------------------------------------------

export type DomainStatus =
  | "pending"
  | "verified"
  | "misconfigured"
  | "failed";

export type DomainVerificationInstructionType = "CNAME" | "A" | "TXT";

export interface DomainVerificationInstruction {
  type: DomainVerificationInstructionType;
  /** Record name (e.g. "_vercel.example.com" or "@" / "www"). */
  name: string;
  /** Record value to add. */
  value: string;
  /** Beginner-safe purpose ("Point this name at your site"). */
  purpose: string;
}

export interface DeploymentDomainRecord {
  /** Normalized domain (lowercase hostname) — also the IndexedDB key. */
  id: string;
  projectId: string;
  deploymentId?: string;
  providerId: string;
  /** The domain as entered (normalized). */
  domain: string;
  status: DomainStatus;
  createdAt: string;
  updatedAt: string;
  /** DNS records the user must add (provider-structured, beginner safe). */
  verification?: DomainVerificationInstruction[];
  /** True when this domain is the primary one for the project. */
  primary?: boolean;
  /** HTTPS is provisioned by the provider automatically. */
  httpsReady?: boolean;
  /** Sanitized provider error summary when status is failed. */
  errorSummary?: string;
}

// ---------------------------------------------------------------------------
// Provider domain wire types (server ↔ client)
// ---------------------------------------------------------------------------

export interface AttachDomainResult {
  domain: string;
  status: DomainStatus;
  verification: DomainVerificationInstruction[];
  httpsReady: boolean;
}

export interface DomainStatusResult {
  domain: string;
  status: DomainStatus;
  verification: DomainVerificationInstruction[];
  httpsReady: boolean;
  /** Provider error code (sanitized) when not verified. */
  providerCode?: string;
}

export interface ListDomainsResult {
  domains: DomainStatusResult[];
}

// ---------------------------------------------------------------------------
// Provider domain client (implemented by provider adapters that support
// custom domains; the DomainService is provider-agnostic)
// ---------------------------------------------------------------------------

export interface DomainProviderClient {
  /** Attach a domain to the provider project. */
  attachDomain(projectId: string, domain: string): Promise<AttachDomainResult>;
  /** Re-check verification/configuration state. */
  getDomainStatus(projectId: string, domain: string): Promise<DomainStatusResult>;
  /** List domains currently attached on the provider. */
  listDomains(projectId: string): Promise<ListDomainsResult>;
  /** Remove a domain from the provider project. */
  removeDomain(projectId: string, domain: string): Promise<void>;
}

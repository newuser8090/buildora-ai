// ---------------------------------------------------------------------------
// Publishing — provider capabilities (Phase P8)
//
// Every provider declares what it can do. The UI derives available actions
// from these flags — generic publishing UI must never hard-code a provider
// name (e.g. "Vercel").
// ---------------------------------------------------------------------------

export interface PublishingProviderCapabilities {
  /** Publishes to a real, public internet URL. */
  realHosting: boolean;
  /** Can attach + verify custom domains. */
  customDomains: boolean;
  /** Can restore/roll back to a previous deployment. */
  rollback: boolean;
  /** Can show deployment build details/logs. */
  deploymentLogs: boolean;
  /** Can cancel a queued/building deployment. */
  cancelDeployment: boolean;
  /** Can delete a deployment (provider + history). */
  deleteDeployment: boolean;
  /** Produces a separate preview URL per deployment. */
  previewDeployments: boolean;
}

/** Local Export — the guaranteed offline fallback. No capabilities. */
export const LOCAL_EXPORT_CAPABILITIES: PublishingProviderCapabilities = {
  realHosting: false,
  customDomains: false,
  rollback: false,
  deploymentLogs: false,
  cancelDeployment: false,
  deleteDeployment: false,
  previewDeployments: false,
};

/** Mock — dev/E2E practice publishing. Never claims public internet. */
export const MOCK_CAPABILITIES: PublishingProviderCapabilities = {
  realHosting: false,
  customDomains: false,
  rollback: true,
  deploymentLogs: false,
  cancelDeployment: false,
  deleteDeployment: true,
  previewDeployments: false,
};

/** Vercel — the P8 real production provider. */
export const VERCEL_CAPABILITIES: PublishingProviderCapabilities = {
  realHosting: true,
  customDomains: true,
  rollback: true,
  deploymentLogs: true,
  cancelDeployment: true,
  deleteDeployment: true,
  previewDeployments: true,
};

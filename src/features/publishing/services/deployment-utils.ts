// ---------------------------------------------------------------------------
// Publishing — deployment helpers (Phase P8)
// ---------------------------------------------------------------------------

import type { DeploymentRecord } from "../types";
import { isSafeDeploymentUrl } from "../domain/domain-utils";

/** The live deployment that is currently active (newest activatedAt). */
export function findActiveDeployment(
  deployments: DeploymentRecord[],
): DeploymentRecord | null {
  const live = deployments.filter((d) => d.status === "live");
  if (live.length === 0) return null;
  return live.sort((a, b) =>
    (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
      a.activatedAt ?? a.completedAt ?? a.createdAt,
    ),
  )[0];
}

/** The public/current URL of a deployment (production alias or provider URL). */
export function liveUrlOf(deployment: DeploymentRecord): string | undefined {
  return (
    deployment.productionUrl ??
    (deployment.providerId === "vercel"
      ? deployment.deploymentUrl
      : deployment.url)
  );
}

/** Safe live URL (https for real providers; localhost allowed for mock). */
export function safeLiveUrl(
  deployment: DeploymentRecord,
): string | null {
  const url = liveUrlOf(deployment);
  if (!url) return null;
  return isSafeDeploymentUrl(url, deployment.providerId) ? url : null;
}

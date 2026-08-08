// ---------------------------------------------------------------------------
// GET /api/publish/vercel/deployments/[deploymentId]/logs (Phase P8)
//
// Sanitized, bounded build details. Beginner default shows simple stages;
// advanced users may expand. Never returns secrets, env vars, or unbounded
// raw output. (Real Vercel event streaming is a documented P9 candidate —
// this endpoint derives bounded stage state + timestamps.)
// ---------------------------------------------------------------------------

import { getVercelApiClient } from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import { fail, ok, providerErrorResponse } from "../../../../_lib";
import type { DeploymentLogEntry } from "@/features/publishing/server/publish-api-types";

interface RouteParams {
  params: Promise<{ deploymentId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { deploymentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(deploymentId)) {
    return fail("DEPLOYMENT_NOT_FOUND", "That deployment no longer exists.", 404);
  }
  const session = await requireBuildoraSession(request);
  if (!session.ok) return fail("AUTH_REQUIRED", session.error.message, 401);

  const client = getVercelApiClient();
  if (!client) {
    return fail("NOT_CONFIGURED", "Vercel publishing isn't configured on this Buildora installation.", 404);
  }

  try {
    const status = await client.getDeployment({
      ownerUserId: session.userId,
      providerDeploymentId: deploymentId,
    });

    // Bounded, sanitized stage timeline derived from provider state.
    const entries: DeploymentLogEntry[] = [];
    const readyState = status.readyState ?? "QUEUED";
    const stageLabel =
      readyState === "READY"
        ? "Live"
        : readyState === "ERROR"
          ? "Build failed"
          : readyState === "CANCELED"
            ? "Cancelled"
            : readyState === "BUILDING"
              ? "Building"
              : "Queued";
    entries.push({
      timestamp: status.buildStartedAt ?? new Date().toISOString(),
      level: readyState === "ERROR" ? "error" : "info",
      stage: stageLabel,
      message:
        readyState === "ERROR"
          ? (status.errorSummary ?? "The build did not complete.")
          : readyState === "READY"
            ? "The site built successfully and is live."
            : "Build is in progress.",
    });
    if (status.buildCompletedAt) {
      entries.push({
        timestamp: status.buildCompletedAt,
        level: "info",
        stage: "Complete",
        message: "Build completed.",
      });
    }
    return ok({ entries });
  } catch (err) {
    return providerErrorResponse(err);
  }
}

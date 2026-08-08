// ---------------------------------------------------------------------------
// POST /api/publish/vercel/deployments/[deploymentId]/rollback (Phase P8)
//
// Repoints the production alias to the target deployment via the provider's
// promote/rollback API. Never touches project editor content — only which
// deployment is current.
// ---------------------------------------------------------------------------

import {
  buildoraProjectName,
  getVercelApiClient,
} from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import { fail, ok, providerErrorResponse, readJsonBody } from "../../../../_lib";
import type { RollbackDeploymentData } from "@/features/publishing/server/publish-api-types";

interface RouteParams {
  params: Promise<{ deploymentId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  const { deploymentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(deploymentId)) {
    return fail("DEPLOYMENT_NOT_FOUND", "That deployment no longer exists.", 404);
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { projectId?: unknown };
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) {
    return fail("INVALID_INPUT", "A project id is required to restore a version.", 400);
  }

  const session = await requireBuildoraSession(request);
  if (!session.ok) return fail("AUTH_REQUIRED", session.error.message, 401);

  const client = getVercelApiClient();
  if (!client) {
    return fail("NOT_CONFIGURED", "Vercel publishing isn't configured on this Buildora installation.", 404);
  }

  try {
    // Rollback addresses the provider project, never the Buildora id — the
    // deterministic project name (same derivation as the deploy route) makes
    // this resolution idempotent.
    const { projectId: providerProjectId } = await client.ensureProject({
      ownerUserId: session.userId,
      name: buildoraProjectName(projectId, process.env.VERCEL_PROJECT_PREFIX),
    });
    const result = await client.promoteDeployment({
      ownerUserId: session.userId,
      projectId: providerProjectId,
      providerDeploymentId: deploymentId,
    });
    return ok({
      providerDeploymentId: deploymentId,
      readyState: result.readyState,
      url: result.url,
      activatedAt: result.activatedAt,
    } satisfies RollbackDeploymentData);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

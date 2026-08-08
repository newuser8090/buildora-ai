// ---------------------------------------------------------------------------
// GET/DELETE /api/publish/vercel/deployments/[deploymentId] (Phase P8)
// ---------------------------------------------------------------------------

import { getVercelApiClient } from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import { fail, ok, providerErrorResponse } from "../../../_lib";

interface RouteParams {
  params: Promise<{ deploymentId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { deploymentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(deploymentId)) {
    return fail("DEPLOYMENT_NOT_FOUND", "That deployment no longer exists.", 404);
  }
  const session = await requireBuildoraSession(_request);
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
    return ok(status);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
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
    await client.deleteDeployment({
      ownerUserId: session.userId,
      providerDeploymentId: deploymentId,
    });
    return ok(null);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

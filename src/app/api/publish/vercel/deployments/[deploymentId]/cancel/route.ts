// ---------------------------------------------------------------------------
// POST /api/publish/vercel/deployments/[deploymentId]/cancel (Phase P8)
// ---------------------------------------------------------------------------

import { getVercelApiClient } from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import { fail, ok, providerErrorResponse, readJsonBody } from "../../../../_lib";

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

  const session = await requireBuildoraSession(request);
  if (!session.ok) return fail("AUTH_REQUIRED", session.error.message, 401);

  const client = getVercelApiClient();
  if (!client) {
    return fail("NOT_CONFIGURED", "Vercel publishing isn't configured on this Buildora installation.", 404);
  }

  try {
    const result = await client.cancelDeployment({
      ownerUserId: session.userId,
      providerDeploymentId: deploymentId,
    });
    return ok(result);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

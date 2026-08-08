// ---------------------------------------------------------------------------
// DELETE /api/publish/vercel/domains/[domain] (Phase P8)
// ---------------------------------------------------------------------------

import {
  buildoraProjectName,
  getVercelApiClient,
} from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import { fail, ok, providerErrorResponse } from "../../../_lib";

interface RouteParams {
  params: Promise<{ domain: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { domain } = await params;
  if (!/^[a-z0-9.-]{1,253}$/.test(domain)) {
    return fail("DOMAIN_INVALID", "That domain isn't valid.", 400);
  }
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) {
    return fail("INVALID_INPUT", "A project id is required.", 400);
  }

  const session = await requireBuildoraSession(request);
  if (!session.ok) return fail("AUTH_REQUIRED", session.error.message, 401);

  const client = getVercelApiClient();
  if (!client) {
    return fail("NOT_CONFIGURED", "Vercel publishing isn't configured on this Buildora installation.", 404);
  }

  try {
    const { projectId: providerProject } = await client.ensureProject({
      ownerUserId: session.userId,
      name: buildoraProjectName(projectId, process.env.VERCEL_PROJECT_PREFIX),
    });
    await client.removeDomain({
      ownerUserId: session.userId,
      projectId: providerProject,
      domain,
    });
    return ok(null);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

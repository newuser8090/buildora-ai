// ---------------------------------------------------------------------------
// DELETE /api/publish/vercel/projects?projectId=... (Phase P8)
//
// Removes the provider project (the published site). This is ONLY called when
// the user explicitly chooses "Also remove the published site" during project
// deletion — deleting a Buildora project never silently deletes the live
// site. The provider project name is derived deterministically server-side.
// ---------------------------------------------------------------------------

import {
  buildoraProjectName,
  getVercelApiClient,
} from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import { fail, ok, providerErrorResponse } from "../../_lib";

export async function DELETE(request: Request) {
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
    await client.deleteProject({
      ownerUserId: session.userId,
      projectName: buildoraProjectName(projectId, process.env.VERCEL_PROJECT_PREFIX),
    });
    return ok(null);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

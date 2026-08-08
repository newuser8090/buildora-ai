// ---------------------------------------------------------------------------
// POST /api/publish/vercel/deploy — create a production deployment (Phase P8)
//
// 1. strict request validation + artifact caps + path sanitization
// 2. server-side session verification
// 3. idempotency (identical recent publishes are reused, not duplicated)
// 4. ensure the deterministic provider project
// 5. create the deployment (files map + uploads) through VercelApiClient
// 6. return provider metadata — never a success claim before the provider
//    acknowledges the deployment (terminal status is confirmed by polling)
// ---------------------------------------------------------------------------

import {
  DeployRequestSchema,
  checkDeployPayload,
} from "@/features/publishing/server/deploy-schema";
import {
  buildoraProjectName,
  getVercelApiClient,
} from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import {
  deployRateLimited,
  lookupIdempotency,
  storeIdempotency,
} from "@/features/publishing/server/publish-idempotency";
import type { DeployResponseData } from "@/features/publishing/server/publish-api-types";
import { fail, ok, providerErrorResponse, readJsonBody } from "../../_lib";

export async function POST(request: Request) {
  // 1. Validate the payload.
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const validated = DeployRequestSchema.safeParse(parsed.body);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    return fail(
      "ARTIFACT_INVALID",
      issue?.message ?? "The publish request was invalid.",
      400,
    );
  }
  const checked = checkDeployPayload(validated.data);
  if (!checked.ok) {
    return fail(
      checked.code as "ARTIFACT_TOO_LARGE" | "ARTIFACT_INVALID",
      checked.message,
      checked.code === "ARTIFACT_TOO_LARGE" ? 413 : 400,
    );
  }

  // 2. Session verification (server-side, never trusted from client state).
  const session = await requireBuildoraSession(request);
  if (!session.ok) return fail("AUTH_REQUIRED", session.error.message, 401);

  const client = getVercelApiClient();
  if (!client) {
    return fail("NOT_CONFIGURED", "Vercel publishing isn't configured on this Buildora installation.", 404);
  }

  const { payload } = checked;

  // 3. Idempotency: identical in-flight/recent publishes are reused.
  const idempotencyKey = payload.idempotencyKey;
  const existing = lookupIdempotency(idempotencyKey);
  if (existing && existing.ownerUserId === session.userId) {
    return ok({
      providerDeploymentId: existing.providerDeploymentId,
      url: existing.url,
      previewUrl: existing.previewUrl,
      readyState: existing.readyState,
      ownerUserId: session.userId,
      reused: true,
    } satisfies DeployResponseData);
  }

  if (deployRateLimited(payload.projectId)) {
    return fail("RATE_LIMITED", "Publishing is temporarily busy. Try again shortly.", 429);
  }

  try {
    // 4. Deterministic provider project (one provider project per Buildora
    //    project, derived from the project id — never raw title text).
    const { projectId, projectName } = await client.ensureProject({
      ownerUserId: session.userId,
      name: buildoraProjectName(payload.projectId, process.env.VERCEL_PROJECT_PREFIX),
    });

    // 5. Create the deployment (files map + upload missing files).
    const created = await client.createDeployment({
      ownerUserId: session.userId,
      projectId,
      projectName,
      files: payload.checkedFiles,
      target: "production",
      idempotencyKey,
    });

    storeIdempotency(idempotencyKey, {
      providerDeploymentId: created.providerDeploymentId,
      url: created.url,
      previewUrl: created.previewUrl,
      readyState: created.readyState,
      createdAt: Date.now(),
      ownerUserId: session.userId,
    });

    return ok({
      providerDeploymentId: created.providerDeploymentId,
      providerProjectId: projectId,
      providerProjectName: projectName,
      url: created.url,
      previewUrl: created.previewUrl,
      readyState: created.readyState,
      ownerUserId: session.userId,
    } satisfies DeployResponseData);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

export async function GET() {
  return fail("INVALID_INPUT", "Use POST to publish.", 405);
}

// ---------------------------------------------------------------------------
// GET/POST /api/publish/vercel/domains (Phase P8)
// ---------------------------------------------------------------------------

import { AttachDomainRequestSchema } from "@/features/publishing/server/deploy-schema";
import {
  buildoraProjectName,
  getVercelApiClient,
} from "@/features/publishing/server/vercel-mode";
import { requireBuildoraSession } from "@/features/publishing/server/publish-auth";
import type { VercelApiClient } from "@/features/publishing/server/vercel-api-client";
import { fail, ok, providerErrorResponse, readJsonBody } from "../../_lib";

/**
 * Resolve the provider project for a Buildora project id. Domains are
 * provider project infrastructure — the provider API addresses them by its
 * own project id (e.g. prj_...), never the Buildora id. The deterministic
 * project name (same derivation as the deploy route) makes this idempotent.
 */
async function providerProjectId(
  client: VercelApiClient,
  ownerUserId: string,
  buildoraProjectId: string,
): Promise<string> {
  const { projectId } = await client.ensureProject({
    ownerUserId,
    name: buildoraProjectName(
      buildoraProjectId,
      process.env.VERCEL_PROJECT_PREFIX,
    ),
  });
  return projectId;
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const validated = AttachDomainRequestSchema.safeParse(parsed.body);
  if (!validated.success) {
    return fail("DOMAIN_INVALID", "Enter just the domain — no https:// needed.", 400);
  }

  const session = await requireBuildoraSession(request);
  if (!session.ok) return fail("AUTH_REQUIRED", session.error.message, 401);

  const client = getVercelApiClient();
  if (!client) {
    return fail("NOT_CONFIGURED", "Vercel publishing isn't configured on this Buildora installation.", 404);
  }

  try {
    const projectId = await providerProjectId(
      client,
      session.userId,
      validated.data.projectId,
    );
    const result = await client.attachDomain({
      ownerUserId: session.userId,
      projectId,
      domain: validated.data.domain.trim().toLowerCase(),
    });
    return ok(result);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

export async function GET(request: Request) {
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
    const providerProject = await providerProjectId(
      client,
      session.userId,
      projectId,
    );
    const result = await client.listDomains({
      ownerUserId: session.userId,
      projectId: providerProject,
    });
    return ok(result);
  } catch (err) {
    return providerErrorResponse(err);
  }
}

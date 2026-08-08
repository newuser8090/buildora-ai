// ---------------------------------------------------------------------------
// Publishing — remove the published site (Phase P8)
//
// Deleting a Buildora project NEVER silently deletes the live production
// site. This is only called after the user explicitly opts in during the
// delete confirmation ("Also remove the published site"). Requires the Vercel
// provider adapter (real or mock) and a signed-in session (server-enforced).
// ---------------------------------------------------------------------------

import { getPublishingProvider } from "../providers";
import { makePublishError, toPublishError, type PublishError } from "../errors";

export async function removePublishedSite(
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: PublishError }> {
  const provider = getPublishingProvider("vercel") as unknown as
    | { deleteProject?: (id: string) => Promise<void> }
    | undefined;
  if (!provider?.deleteProject) {
    return {
      ok: false,
      error: makePublishError(
        "PROVIDER_UNAVAILABLE",
        "The published site can't be removed right now.",
      ),
    };
  }
  try {
    await provider.deleteProject(projectId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toPublishError(err, "UNKNOWN") };
  }
}

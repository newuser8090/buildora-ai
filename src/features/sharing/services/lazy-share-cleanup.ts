// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — lazy share cleanup
//
// Imported by the persistence controller / project service so project
// deletion revokes all of the project's share links and deletes its review
// comments WITHOUT creating a static dependency cycle (persistence ⇄
// sharing). The dynamic import is fire-and-forget and best-effort.
//
// Truthfulness: the caller can inspect the result — if the remote cleanup
// failed, `ok` is false and the delete flow can surface that sharing may not
// have been fully revoked (it must never PRETEND cleanup succeeded).
// ---------------------------------------------------------------------------

export interface ShareCleanupResult {
  ok: boolean;
  revokedShares?: number;
  deletedComments?: number;
}

export async function lazyShareCleanup(projectId: string): Promise<ShareCleanupResult> {
  // Device-cache hygiene: the project is being deleted, so forget its local
  // share ids AND raw tokens even if the server call below fails — the cache
  // is an optimization only and must never outlive the project (raw share
  // tokens must not persist after the project is gone).
  try {
    const { cachedShareIds, clearCachedShareIds, removeCachedShareToken } =
      await import("./share-local-cache");
    for (const shareId of cachedShareIds(projectId)) {
      removeCachedShareToken(shareId);
    }
    clearCachedShareIds(projectId);
  } catch {
    // Cache purge is best-effort.
  }

  try {
    const { getShareProvider, ShareLinkService } = await import(
      "./share-link-service"
    );
    const provider = getShareProvider();
    if (!provider) {
      // No cloud backend configured — nothing to clean up.
      return { ok: true, revokedShares: 0, deletedComments: 0 };
    }
    const service = new ShareLinkService(provider);
    const result = await service.deleteProjectShareData(projectId);
    if (result.ok) {
      return {
        ok: true,
        revokedShares: result.value.revokedShares,
        deletedComments: result.value.deletedComments,
      };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

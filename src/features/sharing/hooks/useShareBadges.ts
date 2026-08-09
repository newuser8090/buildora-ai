"use client";

// ---------------------------------------------------------------------------
// useShareBadges — dashboard "Shared" badges (Phase P12)
//
// ONE batch request per dashboard load for all visible project ids (never
// N+1), cached for the session, and fully silent when offline / unconfigured
// / failing — a badge is a nicety, never a blocking feature.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useAuthStore } from "@/features/auth/auth-store";
import { getShareProvider, ShareLinkService } from "../services/share-link-service";

/** Session cache: projectId -> hasActiveShare. */
const badgeCache = new Map<string, boolean>();

export function useShareBadges(projectIds: string[]): Record<string, boolean> {
  const key = projectIds.join(",");
  const authStatus = useAuthStore((s) => s.status);
  const [badges, setBadges] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const id of projectIds) {
      if (badgeCache.has(id)) out[id] = badgeCache.get(id) ?? false;
    }
    return out;
  });

  useEffect(() => {
    if (!key) return;
    // Owner-only feature: never hit the share API without a session (the
    // server would 401 and the dashboard must stay quiet while signed out).
    if (authStatus !== "signed-in") {
      // Drop the session cache so one account's badges can never leak into
      // the next sign-in (statusBatch is owner-scoped).
      badgeCache.clear();
      // requestAnimationFrame defers the reset past the effect (the codebase
      // set-state-in-effect convention).
      const raf = requestAnimationFrame(() => setBadges({}));
      return () => cancelAnimationFrame(raf);
    }
    const provider = getShareProvider();
    if (!provider) return; // unconfigured / local-only: silently no badges

    // Everything cached? The initializer already has the full badge set.
    const missing = projectIds.filter((id) => !badgeCache.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    const service = new ShareLinkService(provider);
    service
      .statusBatch(missing)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          for (const [id, has] of Object.entries(result.value)) {
            badgeCache.set(id, has === true);
          }
        }
        setBadges(
          Object.fromEntries(projectIds.map((id) => [id, badgeCache.get(id) ?? false])),
        );
      })
      .catch(() => {
        if (!cancelled) {
          // Failure is silent: leave badges empty for the missing ids.
          setBadges(
            Object.fromEntries(projectIds.map((id) => [id, badgeCache.get(id) ?? false])),
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, authStatus]);

  return badges;
}

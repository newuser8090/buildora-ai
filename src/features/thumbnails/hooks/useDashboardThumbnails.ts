// ---------------------------------------------------------------------------
// useDashboardThumbnails
//
// Dashboard-facing thumbnail loader. Given the project summaries (id +
// revision), it:
//   1. lists lightweight thumbnail metadata for all projects (one cheap read)
//   2. loads the Blob record for each project (asynchronously, after paint)
//   3. manages runtime object URLs (created on display, revoked on change)
//   4. derives card state: missing | loading | ready | stale | error
//
// First paint never waits for thumbnails — cards render placeholders and
// upgrade asynchronously. Object URLs are NEVER persisted and are revoked
// when the Blob changes or the hook unmounts.
//
// Eventual-thumbnail policy (Phase G §3) — the dashboard must handle a
// thumbnail that is still being generated when the user returns from the
// editor:
//   - PRIMARY: the scheduler/storage bridge publishes a "ready" notification
//     { projectId, revision } ONLY after the IndexedDB write transaction has
//     committed. The hook subscribes and reloads just that project.
//   - RESILIENCE: a bounded exponential retry re-reads projects that still
//     have no thumbnail, stopping after THUMBNAIL_RETRY_MAX_ATTEMPTS (no
//     permanent polling, no load on every render, cancelled on unmount/key
//     change).
//   - Stale notifications (revision < project summary revision) are ignored —
//     a newer generation is pending; the matching revision arrives later and
//     replaces it. Duplicate notifications never trigger duplicate loads.
//
// Reload semantics:
//   - The effect re-runs when any project's { id, revision } changes (e.g.
//     after a save + dashboard refresh). A project whose stored thumbnail
//     revision no longer matches the list revision is re-fetched.
//   - reload(projectId) invalidates one project so manual regeneration
//     results appear without a full remount.
//
// Scaling note: metadata is a single cheap read; Blobs are loaded per project
// asynchronously (all at once for typical dashboards — acceptable per the
// Phase G spec). For very large dashboards this can be refined with an
// IntersectionObserver; the per-card upgrade keeps first paint fast today.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getThumbnailStorage,
  subscribeThumbnailReady,
} from "../services/thumbnail-save-bridge";
import { ThumbnailDashboardService } from "../services/thumbnail-dashboard-service";
import {
  THUMBNAIL_RETRY_BASE_DELAY_MS,
  THUMBNAIL_RETRY_MAX_ATTEMPTS,
} from "../constants";
import type { ThumbnailError } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardThumbnailStatus =
  | "missing"
  | "loading"
  | "ready"
  | "stale"
  | "error";

export interface DashboardThumbnailState {
  status: DashboardThumbnailStatus;
  /** Runtime object URL — never persisted. */
  url: string | null;
  /** Revision the current thumbnail represents (null when missing). */
  revision: number | null;
  error?: ThumbnailError;
}

export interface ThumbnailProjectRef {
  id: string;
  revision: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Load and manage thumbnail state for a set of dashboard projects.
 * Pass a stable list of { id, revision } refs; results are keyed by project id.
 */
export function useDashboardThumbnails(
  projects: ThumbnailProjectRef[],
): {
  thumbnails: Record<string, DashboardThumbnailState>;
  /** Invalidate one project so its thumbnail is re-fetched (e.g. after manual regeneration). */
  reload: (projectId: string) => void;
} {
  const [thumbnails, setThumbnails] = useState<Record<string, DashboardThumbnailState>>({});
  const urlByProject = useRef<Map<string, string>>(new Map());

  // When no thumbnail storage is available, every project stays "missing".
  // Derived at render time (rather than setState in an effect body) so the
  // hook never calls setState synchronously inside an effect
  // (react-hooks/set-state-in-effect).
  const effectiveThumbnails = useMemo(() => {
    if (getThumbnailStorage()) return thumbnails;
    const next: Record<string, DashboardThumbnailState> = {};
    for (const p of projects) {
      next[p.id] = { status: "missing", url: null, revision: null };
    }
    return next;
  }, [thumbnails, projects]);
  /** projectId -> revision already loaded for this project. */
  const loadedRef = useRef<Map<string, number>>(new Map());
  const generationRef = useRef(0);
  const [refreshVersion, setRefreshVersion] = useState(0);

  // Latest snapshots for stable subscriptions / bounded retries (timers and
  // ready listeners must never capture a stale projects/thumbnails closure).
  // Synced in an effect (never during render — react-hooks/refs) so the refs
  // always mirror the latest render's values before any async listener/timer
  // fires.
  const projectsRef = useRef(projects);
  const thumbnailsRef = useRef(thumbnails);
  useEffect(() => {
    projectsRef.current = projects;
    thumbnailsRef.current = thumbnails;
  });
  /**
   * Latest ready-notification revision per project. Guards against duplicate
   * notifications in the same tick re-triggering the same reload while the
   * previous one is still settling.
   */
  const notifiedRevisionRef = useRef<Map<string, number>>(new Map());

  // Revoke all object URLs on unmount.
  useEffect(() => {
    const urls = urlByProject.current;
    return () => {
      for (const url of urls.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // revoke failure must not crash
        }
      }
      urls.clear();
    };
  }, []);

  /** Invalidate a single project: revoke its URL and force a re-fetch. */
  const reload = useCallback((projectId: string) => {
    loadedRef.current.delete(projectId);
    const previousUrl = urlByProject.current.get(projectId);
    if (previousUrl) {
      try {
        URL.revokeObjectURL(previousUrl);
      } catch {
        // ignore
      }
      urlByProject.current.delete(projectId);
    }
    setThumbnails((prev) => ({
      ...prev,
      [projectId]: { status: "loading", url: null, revision: null },
    }));
    setRefreshVersion((v) => v + 1);
  }, []);

  // -------------------------------------------------------------------------
  // Completion subscription (PRIMARY eventual-thumbnail path)
  //
  // The scheduler publishes { projectId, revision } ONLY after the storage
  // write transaction committed, so a reload here is guaranteed to find the
  // record. Subscribed once (reload is stable); reads latest projects/state
  // through refs. Cleaned up on unmount.
  // -------------------------------------------------------------------------
  useEffect(() => {
    return subscribeThumbnailReady(({ projectId, revision }) => {
      const target = projectsRef.current.find((p) => p.id === projectId);
      if (!target) return;

      // Ignore stale notifications: the summary has already moved past this
      // revision, so a newer generation is pending — reloading would only
      // re-show a stale record (no stale lower-revision load).
      if (revision < target.revision) return;

      // Already showing this revision (or newer) — no duplicate load.
      const current = thumbnailsRef.current[projectId];
      if (current?.url && (current.revision ?? -1) >= revision) return;

      // Same-tick duplicate guard while a reload is still settling.
      if ((notifiedRevisionRef.current.get(projectId) ?? -1) >= revision) return;
      notifiedRevisionRef.current.set(projectId, revision);

      reload(projectId);
    });
  }, [reload]);

  const key = `${projects.map((p) => `${p.id}:${p.revision}`).join("|")}#${refreshVersion}`;

  useEffect(() => {
    const generation = ++generationRef.current;
    const storage = getThumbnailStorage();
    if (!storage) {
      // No storage → every project stays "missing" (derived at render time).
      return;
    }

    const service = new ThumbnailDashboardService(storage);
    let cancelled = false;

    // In-flight marker set, local to this effect run: prevents duplicate
    // blob loads within one run (retry timer vs. initial pass). Each effect
    // run has its own set, so a superseded run can never interfere with a
    // newer run's markers.
    const inFlightLoads = new Set<string>();

    // Revoke URLs for projects that are no longer in the list (deleted, etc.)
    // so object URLs never leak while the dashboard stays mounted. Also
    // clears any pending ready-notification markers so a removed-then-readded
    // project can never be suppressed by a stale notified revision.
    const currentIds = new Set(projects.map((p) => p.id));
    for (const [id, url] of urlByProject.current) {
      if (!currentIds.has(id)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
        urlByProject.current.delete(id);
        loadedRef.current.delete(id);
        inFlightLoads.delete(id);
        notifiedRevisionRef.current.delete(id);
      }
    }

    // 1. Lightweight metadata pass — which projects have a thumbnail and at
    //    which revision. A metadata failure is NON-blocking: we simply skip
    //    the pre-mark and let the Blob loads (source of truth) determine
    //    state, rather than flashing every card to "missing".
    const runMetadataPass = () => {
      void service.listMetadata().then((result) => {
        if (cancelled || generation !== generationRef.current) return;
        if (!result.success) return;

        const metaById = ThumbnailDashboardService.indexMetadata(result.items);

        setThumbnails((prev) => {
          const next = { ...prev };
          for (const p of projects) {
            const meta = metaById.get(p.id);
            const existing = next[p.id];
            if (!meta) {
              // No thumbnail record — only override if we aren't already
              // showing a URL (avoid clobbering a displayed thumbnail).
              if (existing?.url) continue;
              next[p.id] = { status: "missing", url: null, revision: null };
            } else if (!existing?.url) {
              // Known to exist; mark loading until the Blob arrives.
              next[p.id] = {
                status: "loading",
                url: null,
                revision: meta.revision,
              };
            }
            // If we already have a URL keep it (avoids churn on refresh).
          }
          return next;
        });
      });
    };

    // 2. Blob load per project. Keyed by revision so a project whose list
    //    revision is newer than the loaded record is re-fetched. The loaded
    //    marker is set ONLY on success so a transient failure is naturally
    //    retried on the next effect run (refresh, revision change, reload).
    const loadProjectBlob = (p: ThumbnailProjectRef) => {
      if (loadedRef.current.get(p.id) === p.revision) return;
      // One load at a time per project — a slow read must not be duplicated
      // by a retry or a ready-notification reload firing mid-flight.
      if (inFlightLoads.has(p.id)) return;
      inFlightLoads.add(p.id);

      service
        .loadRecord(p.id)
        .then((loadResult) => {
          // The set is local to this effect run, so the marker always belongs
          // to this run — safe to clear unconditionally here.
          inFlightLoads.delete(p.id);
          if (cancelled || generation !== generationRef.current) return;

          if (!loadResult.success) {
            setThumbnails((prev) => {
              const existing = prev[p.id];
              // A load failure must not clobber an already-displayed URL.
              if (existing?.url) return prev;
              return {
                ...prev,
                [p.id]: {
                  status: loadResult.error.code === "PROJECT_NOT_FOUND" ? "missing" : "error",
                  url: null,
                  revision: null,
                  error: loadResult.error,
                },
              };
            });
            return;
          }

          const record = loadResult.record;
          const isStale = record.revision < p.revision;

          // Create an object URL for this Blob.
          let url: string | null = null;
          try {
            url = URL.createObjectURL(record.data);
          } catch {
            url = null;
          }

          // Revoke the previous URL for this project (if any).
          const previousUrl = urlByProject.current.get(p.id);
          if (previousUrl && previousUrl !== url) {
            try {
              URL.revokeObjectURL(previousUrl);
            } catch {
              // ignore
            }
          }
          if (url) {
            urlByProject.current.set(p.id, url);
          }

          // Mark as loaded ONLY after a successful fetch.
          loadedRef.current.set(p.id, p.revision);
          // A settled display satisfies any pending ready notification for
          // this revision — future duplicate notifications are deduped by the
          // shown-revision guard in the ready listener.
          notifiedRevisionRef.current.delete(p.id);

          setThumbnails((prev) => ({
            ...prev,
            [p.id]: {
              status: isStale ? "stale" : "ready",
              url,
              revision: record.revision,
            },
          }));
        })
        .catch(() => {
          inFlightLoads.delete(p.id);
          // Never let a load failure throw into the React tree.
        });
    };

    const runLoadPass = () => {
      runMetadataPass();
      for (const p of projects) loadProjectBlob(p);
    };

    runLoadPass();

    // 3. Bounded retry (RESILIENCE path). If any project still has no
    //    thumbnail after this pass, re-read with exponential backoff up to
    //    THUMBNAIL_RETRY_MAX_ATTEMPTS. Stops as soon as every project has a
    //    URL. Cancelled on unmount / key change. Never permanent polling, and
    //    never starts at all when nothing is missing.
    let retryAttempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const anyMissing = () =>
      projects.some((p) => {
        const t = thumbnailsRef.current[p.id];
        return !t?.url;
      });
    const scheduleRetry = () => {
      if (cancelled || generation !== generationRef.current) return;
      if (retryAttempts >= THUMBNAIL_RETRY_MAX_ATTEMPTS) return;
      // Short-circuit: don't arm a timer at all when every card is already
      // showing a thumbnail (avoids a pointless 500ms timer per effect run).
      if (!anyMissing()) return;

      const delay = THUMBNAIL_RETRY_BASE_DELAY_MS * 2 ** retryAttempts;
      retryAttempts += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (cancelled || generation !== generationRef.current) return;

        if (!anyMissing()) return;

        runLoadPass();
        scheduleRetry();
      }, delay);
    };
    scheduleRetry();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      // No marker cleanup needed: the in-flight set is local to this effect
      // run and dies with the closure. The generation guard already discards
      // any state updates from the superseded run.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { thumbnails: effectiveThumbnails, reload };
}

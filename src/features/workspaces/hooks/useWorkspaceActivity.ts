"use client";

// ---------------------------------------------------------------------------
// Phase P15 — useWorkspaceActivity
//
// Paginated (createdAt DESC, id DESC) activity feed with category filters.
// One service + one hook powers both the dashboard Workspace Activity tab and
// the editor project-activity tab (which filters by project client-side).
//
// Concurrency: every fetch bumps a request sequence; a response only commits
// state if it is still the latest request. Scope/filter/project changes reset
// the pagination refs synchronously in the effect (refs are fine there) and
// start a fresh fetch — the sequence guard + effect cleanup ensure an in-flight
// older request can never commit stale events. The effect-driven fetch is an
// inline async IIFE (state commits after the awaited call — the same pattern
// as the P14 settings dialog); `fetchActivity` (load-more) is only ever called
// from the loadMore event handler.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { getWorkspaceProvider } from "../services/workspace-service";
import { WorkspaceService } from "../services/workspace-service";
import type {
  ActivityCursor,
  WorkspaceActivityEvent,
  WorkspaceActivityFilter,
} from "../types";

export function useWorkspaceActivity(
  workspaceId: string | null,
  options?: { projectId?: string | null },
) {
  const [events, setEvents] = useState<WorkspaceActivityEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkspaceActivityFilter>("all");
  // The scope the currently-committed events belong to (display reset is
  // derived from it — never a sync setState in the effect).
  const [loadedScope, setLoadedScope] = useState("");

  const scopeKey = workspaceId ?? "";
  const projectFilter = options?.projectId ?? null;

  // Full (pre-project-filter) event list + pagination cursor. Written ONLY
  // inside the fetch callbacks after the awaited fetch — never during render.
  const eventsRef = useRef<WorkspaceActivityEvent[]>([]);
  const cursorRef = useRef<ActivityCursor | null>(null);
  // Monotonic request sequence: a response superseded by a newer request
  // (scope/filter change) never commits. The effect cleanup also bumps it so
  // an in-flight fetch can't commit after unmount/switch.
  const requestSeqRef = useRef(0);
  const loadingMoreRef = useRef(false);

  // Initial/fresh load on mount or scope/filter/project change. Inline async
  // IIFE (P14 pattern): all state commits happen after the awaited fetch, so
  // the effect body itself has no synchronous setState.
  useEffect(() => {
    eventsRef.current = [];
    cursorRef.current = null;
    if (!workspaceId) return;
    let cancelled = false;
    void (async () => {
      const provider = getWorkspaceProvider();
      if (!provider) return;
      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);
      const service = new WorkspaceService(provider);
      const result = await service.listActivity({
        workspaceId,
        before: null,
        limit: 30,
        filter,
      });
      if (cancelled || seq !== requestSeqRef.current) return;
      loadingMoreRef.current = false;
      if (result.ok) {
        eventsRef.current = result.value.events;
        cursorRef.current = result.value.nextCursor;
        setLoadedScope(scopeKey);
        const visible = projectFilter
          ? eventsRef.current.filter((e) => e.projectId === projectFilter)
          : eventsRef.current;
        setEvents(visible);
        setHasMore(!!result.value.nextCursor && eventsRef.current.length < 200);
      } else {
        setLoadedScope(scopeKey);
        setError(result.error.message);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      // Invalidate any in-flight fetch so it can't commit after switch/unmount.
      requestSeqRef.current += 1;
    };
  }, [workspaceId, filter, projectFilter, scopeKey]);

  // Load-more (event-handler only — the synchronous loading flip is fine).
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    void (async () => {
      const provider = getWorkspaceProvider();
      if (!workspaceId || !provider) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      setError(null);
      const seq = ++requestSeqRef.current;
      const service = new WorkspaceService(provider);
      const result = await service.listActivity({
        workspaceId,
        before: cursorRef.current,
        limit: 30,
        filter,
      });
      if (seq !== requestSeqRef.current) {
        loadingMoreRef.current = false;
        return;
      }
      loadingMoreRef.current = false;
      if (result.ok) {
        eventsRef.current = [...eventsRef.current, ...result.value.events];
        cursorRef.current = result.value.nextCursor;
        setLoadedScope(scopeKey);
        const visible = projectFilter
          ? eventsRef.current.filter((e) => e.projectId === projectFilter)
          : eventsRef.current;
        setEvents(visible);
        setHasMore(!!result.value.nextCursor && eventsRef.current.length < 200);
      } else {
        setLoadedScope(scopeKey);
        setError(result.error.message);
      }
      setLoadingMore(false);
    })();
  }, [workspaceId, filter, projectFilter, scopeKey]);

  // Derived display values: stale-scope data is never shown.
  const visibleEvents = loadedScope === scopeKey ? events : [];
  const visibleLoading = loading || (loadedScope !== scopeKey && scopeKey !== "");
  const visibleError = loadedScope === scopeKey ? error : null;

  return {
    events: visibleEvents,
    hasMore,
    loading: visibleLoading,
    loadingMore,
    error: visibleError,
    filter,
    setFilter,
    loadMore,
  };
}

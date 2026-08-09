"use client";

// ---------------------------------------------------------------------------
// useShareSnapshotSync — keeps shared projections fresh (Phase P12)
//
// LIVE-PROJECTION model: while a project has active review links, this hook
// pushes an updated sanitized projection to the server after the project
// changes (debounced). Strictly best-effort:
//   - inert when the local cache knows of no active shares for this project
//   - inert when offline (resumes on the next save once online)
//   - never blocks, never throws into the editor, never touches project state
//   - editor startup does NOT depend on sharing APIs (no network on mount)
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getShareProvider, ShareLinkService } from "../services/share-link-service";
import { cachedShareIds } from "../services/share-local-cache";
import { buildShareProjection, serializeProjection } from "../projection/sanitize-share-projection";
import { SHARE_SNAPSHOT_DEBOUNCE_MS } from "../constants";

export function useShareSnapshotSync(): void {
  const isHydrated = useEditorStore((s) => s.isHydrated);
  const project = useEditorStore((s) => s.project);
  const revision = useEditorStore((s) => s.revision);

  // Track the last revision we pushed so redundant pushes are skipped.
  const lastPushedRevision = useRef<number | null>(null);
  // Track which project the last push belonged to (reset on project switch).
  const pushedProjectId = useRef<string | null>(null);

  useEffect(() => {
    if (!isHydrated || !project.id) return;
    // Project switch → drop the pushed-revision memory.
    if (pushedProjectId.current !== null && pushedProjectId.current !== project.id) {
      lastPushedRevision.current = null;
    }
    pushedProjectId.current = project.id;

    const shareIds = cachedShareIds(project.id);
    if (shareIds.length === 0) return; // no active shares on this device

    if (typeof navigator !== "undefined" && !navigator.onLine) return; // offline

    if (lastPushedRevision.current === revision) return; // already fresh

    const timer = setTimeout(() => {
      const provider = getShareProvider();
      if (!provider) return;
      const projection = buildShareProjection(useEditorStore.getState().project);
      if (!projection.ok) return; // too large — keep last good snapshot
      const json = serializeProjection(projection.projection);
      const service = new ShareLinkService(provider);
      const currentRevision = useEditorStore.getState().revision;
      void Promise.all(
        shareIds.map((shareId) =>
          service.pushSnapshot(shareId, json, currentRevision).catch(() => undefined),
        ),
      ).then(() => {
        // Record the revision ONLY if it is still the live revision (a newer
        // change in flight will schedule its own push).
        const live = useEditorStore.getState().revision;
        if (live === currentRevision) {
          lastPushedRevision.current = currentRevision;
        }
      });
    }, SHARE_SNAPSHOT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [isHydrated, project.id, revision]);
}

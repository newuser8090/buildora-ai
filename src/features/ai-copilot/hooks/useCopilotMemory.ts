"use client";

// ---------------------------------------------------------------------------
// useCopilotMemory — Phase P11 project memory bridge
//
// Mounted ONCE in EditorShell (survives the Copilot panel being open or
// closed). Responsibilities:
//
//   1. When the editor hydrates a project (isHydrated + activeProjectId),
//      load the persisted copilotMemory record and hydrate the Copilot
//      store (messages + styleNotes ONLY — plan/approval state is never
//      restored).
//   2. When the conversation or style notes change, write the bounded record
//      (microtask-coalesced) so a reload can restore it.
//   3. On project switch the existing useCopilot reset fires first; this
//      hook then loads the NEW project's memory. As defense-in-depth for
//      SPA navigation (dashboard ⇄ editor), the hook ALSO resets the store
//      once per fresh mount so a previous editor session's conversation can
//      never hydrate into — or later persist under — a different project.
//
// The hook never touches project state and never throws into the editor.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useCopilotStore } from "../store/copilot-store";
import { getCopilotMemoryService } from "../memory/services/copilot-memory-service";

export function useCopilotMemory(): void {
  const loadedProjectRef = useRef<string | null>(null);

  // Track the last saved snapshot so writes only happen on real changes.
  const lastSavedRef = useRef<{ messages: number; styleNotes: string }>({
    messages: -1,
    styleNotes: "",
  });
  // Coalesces writes to one per event-loop turn (messages only change on
  // send/apply, so this is never per-keystroke).
  const writeQueuedRef = useRef(false);
  // Monotonic load token — StrictMode-safe supersession: the LATEST load
  // attempt wins; superseded/cancelled loads become no-ops.
  const loadTokenRef = useRef(0);
  // Fresh-mount isolation: the Copilot store is a module singleton, so a
  // FRESH editor mount (e.g. SPA navigation dashboard → editor, or editor A
  // → dashboard → editor B) may still hold the previous editor session's
  // conversation. useCopilot's project-switch reset only fires on an
  // activeProjectId CHANGE while the editor is mounted — it does NOT fire
  // here, because openProject() already set the new activeProjectId before
  // EditorShell mounted. Without this reset the load's "conversation in
  // progress" guard would misclassify the OLD project's messages as an
  // in-progress conversation: the new project's memory would never hydrate
  // and the old conversation could be written into the new project's record.
  // The reset runs exactly once per real mount (StrictMode's simulated
  // remount reuses the same refs).
  const didInitialResetRef = useRef(false);

  // Selectors extracted so the effect dependency array is statically checkable.
  const activeProjectId = useEditorStore((s) => s.activeProjectId);
  const isHydrated = useEditorStore((s) => s.isHydrated);

  useEffect(() => {
    // Fresh-mount isolation (see didInitialResetRef). Runs before the first
    // load so the store is always clean when a project's memory loads.
    if (!didInitialResetRef.current) {
      didInitialResetRef.current = true;
      useCopilotStore.getState().reset();
    }

    const projectId = activeProjectId;

    if (!isHydrated || !projectId) return;
    loadedProjectRef.current = projectId;
    const token = ++loadTokenRef.current;

    // Load persisted memory for the freshly opened project. Token-based: a
    // StrictMode setup → cleanup → setup cycle starts two loads; only the
    // last one (matching token) may hydrate. Never hydrates a DIFFERENT
    // project, and never clobbers a conversation already in progress.
    void getCopilotMemoryService()
      .load(projectId)
      .then((record) => {
        if (token !== loadTokenRef.current) return;
        if (useEditorStore.getState().activeProjectId !== projectId) return;
        const store = useCopilotStore.getState();
        // A conversation already in progress (user typed before the load
        // resolved) is authoritative — never clobber it with saved memory.
        if (store.messages.length > 0 || store.styleNotes.length > 0) {
          lastSavedRef.current = {
            messages: store.messages.length,
            styleNotes: JSON.stringify(store.styleNotes),
          };
          return;
        }
        useCopilotStore.getState().hydrateMemory({
          messages: record?.messages ?? [],
          styleNotes: record?.styleNotes ?? [],
        });
        lastSavedRef.current = {
          messages: record?.messages.length ?? 0,
          styleNotes: JSON.stringify(record?.styleNotes ?? []),
        };
      })
      .catch(() => {
        if (token !== loadTokenRef.current) return;
        // Best-effort — never throw into the editor load path.
        lastSavedRef.current = { messages: 0, styleNotes: "[]" };
      });
  }, [activeProjectId, isHydrated]);

  // Microtask-coalesced save when the conversation or style notes change.
  useEffect(() => {
    // Perform the actual write for the current store state. Coalescing is
    // handled by the caller (queued microtask vs. immediate flush).
    const writeCurrent = () => {
      const projectId = useEditorStore.getState().activeProjectId;
      if (!projectId || loadedProjectRef.current !== projectId) return;
      const current = useCopilotStore.getState();
      const signature = {
        messages: current.messages.length,
        styleNotes: JSON.stringify(current.styleNotes),
      };
      if (
        signature.messages === lastSavedRef.current.messages &&
        signature.styleNotes === lastSavedRef.current.styleNotes
      ) {
        return;
      }
      const empty =
        current.messages.length === 0 && current.styleNotes.length === 0;
      // An explicitly cleared conversation deletes the record instead of
      // re-creating an empty one ("no record" === "no memory").
      const op = empty
        ? getCopilotMemoryService().clear(projectId)
        : getCopilotMemoryService().save({
            projectId,
            messages: current.messages,
            styleNotes: current.styleNotes,
          });
      void op.catch(() => {
        // Best-effort — a failed write never breaks the conversation.
      });
      lastSavedRef.current = signature;
    };

    const writePending = () => {
      if (writeQueuedRef.current) return;
      writeQueuedRef.current = true;
      queueMicrotask(() => {
        writeQueuedRef.current = false;
        writeCurrent();
      });
    };

    const unsub = useCopilotStore.subscribe(writePending);

    // On page hide/close, write IMMEDIATELY (no queued microtask) so the very
    // last message is not lost when the page unloads. Best-effort.
    const flushOnHide = () => {
      if (!writeQueuedRef.current) writeCurrent();
    };
    window.addEventListener("pagehide", flushOnHide);
    window.addEventListener("visibilitychange", flushOnHide);

    return () => {
      unsub();
      window.removeEventListener("pagehide", flushOnHide);
      window.removeEventListener("visibilitychange", flushOnHide);
    };
  }, []);
}

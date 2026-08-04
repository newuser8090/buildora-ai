"use client";

import { useEffect } from "react";
import { useBlockEditorStore } from "../store/block-editor-store";
import { BuildTreePanel } from "./BuildTreePanel";
import { BlockInspector } from "./BlockInspector";
import { BlockBrowserDialog } from "./BlockBrowserDialog";

// ---------------------------------------------------------------------------
// BlockEditorPanel — the "Blocks" tab of the right sidebar (Phase O)
// ---------------------------------------------------------------------------

export function BlockEditorPanel() {
  const init = useBlockEditorStore((s) => s.init);
  const hydrated = useBlockEditorStore((s) => s.hydrated);

  // Load persisted favorites (localStorage) once after mount. EditorProvider
  // also calls useBlockEditorInit() — this copy is a safety net for renders
  // where this panel mounts standalone (component tests). Both are idempotent.
  useEffect(() => {
    if (!hydrated) init();
  }, [hydrated, init]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BuildTreePanel />
        <BlockInspector />
      </div>
      <BlockBrowserDialog />
    </div>
  );
}

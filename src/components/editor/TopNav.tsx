"use client";

import { useState } from "react";
import {
  Sparkles,
  Undo2,
  Redo2,
  Save,
  Download,
  CircleUser,
  Loader2,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { exportProject } from "@/features/export/pipeline/export-pipeline";
import { cn } from "@/utils/cn";

const iconButton =
  "flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95";

const iconButtonDisabled =
  "flex h-8 w-8 items-center justify-center rounded-lg text-text-dim/30 cursor-not-allowed";

export function TopNav() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo());
  const canRedo = useEditorStore((s) => s.canRedo());
  const project = useEditorStore((s) => s.project);

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      const result = await exportProject(project);
      if (!result.success) {
        setExportError(result.error ?? "Export failed");
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-secondary px-4">
      {/* ---- Left: Brand + Project ---- */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            Buildora
          </span>
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-card">
          <span className="text-sm text-text-muted transition-colors duration-200">
            {project.name || "Untitled Project"}
          </span>
        </div>
      </div>

      {/* ---- Spacer ---- */}
      <div className="flex-1" />

      {/* ---- Actions ---- */}
      <div className="flex items-center gap-1">
        <button
          data-testid="undo-button"
          className={cn(canUndo ? iconButton : iconButtonDisabled)}
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          type="button"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          data-testid="redo-button"
          className={cn(canRedo ? iconButton : iconButtonDisabled)}
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          type="button"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="mx-1.5 h-4 w-px bg-border" />

        <button
          className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-dim transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
          title="Save"
          type="button"
        >
          <Save className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">Save</span>
        </button>

        <button
          data-testid="export-button"
          onClick={handleExport}
          disabled={exporting}
          className="flex h-8 items-center gap-2 rounded-lg bg-primary/10 px-2.5 text-sm text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          title={exporting ? "Exporting..." : "Export project as ZIP"}
          type="button"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          <span className="hidden sm:inline text-xs">
            {exporting ? "Exporting..." : "Export"}
          </span>
        </button>
      </div>

      {/* ---- Export error toast ---- */}
      {exportError && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          <p className="font-medium">Export failed</p>
          <p className="mt-1 text-xs text-red-600">{exportError}</p>
          <button
            onClick={() => setExportError(null)}
            className="mt-2 text-xs font-medium text-red-700 underline hover:no-underline"
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- Avatar ---- */}
      <div>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-text-dim transition-all duration-200 hover:bg-accent/15 hover:text-accent active:scale-95"
          aria-label="User menu"
          type="button"
        >
          <CircleUser className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

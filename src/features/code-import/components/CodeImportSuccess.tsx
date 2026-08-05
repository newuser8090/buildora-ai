"use client";

// ---------------------------------------------------------------------------
// CodeImportSuccess — Step 5 of the Import Studio.
// "Your design was added." with quick actions. Nothing is published or
// exported automatically.
// ---------------------------------------------------------------------------

import { CheckCircle2, Pencil, Layers, Copy, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useCodeImport } from "../hooks/useCodeImport";

export function CodeImportSuccess() {
  const { cancel } = useCodeImport();
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const setRightSidebarTab = useEditorUiStore((s) => s.setRightSidebarTab);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);

  const handleEditNow = () => {
    setRightSidebarTab("blocks");
    cancel();
  };

  const handleDuplicate = () => {
    if (!selectedSectionId) return;
    duplicateSection(selectedSectionId);
    setRightSidebarTab("blocks");
    cancel();
  };

  return (
    <div
      data-testid="import-success"
      className="flex flex-col items-center gap-5 py-6 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
        <CheckCircle2 className="h-7 w-7 text-emerald-400" aria-hidden="true" />
      </span>

      <div>
        <h3 className="text-lg font-semibold text-text-primary">
          Your design was added.
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-text-muted">
          It is now an editable part of your page — everything is saved, and
          one Undo will remove the whole design if you change your mind.
        </p>
      </div>

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        <Button type="button" size="md" onClick={handleEditNow} data-testid="success-edit-now">
          <Pencil className="h-4 w-4" />
          Edit now
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => {
            setRightSidebarTab("blocks");
            cancel();
          }}
          data-testid="success-view-tree"
        >
          <Layers className="h-4 w-4" />
          View in Build Tree
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={handleDuplicate}
          data-testid="success-duplicate"
        >
          <Copy className="h-4 w-4" />
          Duplicate
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          disabled
          title="Coming next"
          data-testid="success-save-block"
        >
          <Sparkles className="h-4 w-4" />
          Save as My Block
          <span className="ml-1 rounded bg-card px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-dim">
            Coming next
          </span>
        </Button>
      </div>

      <Button variant="ghost" size="sm" onClick={cancel} data-testid="success-close">
        <X className="h-3.5 w-3.5" />
        Close
      </Button>
    </div>
  );
}

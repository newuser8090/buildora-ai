"use client";

import { useEffect } from "react";
import { useInlineEdit } from "../hooks/useInlineEdit";
import { useInlineEditingStore } from "../store/inline-editing-store";
import { InlineEditToolbar } from "./InlineEditToolbar";
import { InlineAiPromptInput } from "./InlineAiPromptInput";
import { InlineAiSuggestionPopover } from "./InlineAiSuggestionPopover";
import { InlineEditOverlay } from "./InlineEditOverlay";

// ---------------------------------------------------------------------------
// InlineEditLayer — composes the floating inline-editing UI (toolbar, AI
// prompt input, suggestion popover, manual edit overlay). Rendered once by
// the Canvas. Owns outside-click handling and anchors the toolbar to the
// selected field.
//
// Pointer behavior: the layer is pointer-events-none; only the individual
// panels are pointer-events-auto, so the canvas preview stays fully
// interactive around them.
// ---------------------------------------------------------------------------

export function InlineEditLayer() {
  const { selectedField, clearField, anchorEl, mode, isBusy } = useInlineEdit();
  const aiPromptOpen = useInlineEditingStore((s) => s.aiPromptOpen);
  const setAiPromptOpen = useInlineEditingStore((s) => s.setAiPromptOpen);

  // Clicking outside the field in the CANVAS clears field selection (spec §5).
  // Editor chrome (sidebar, top nav, tabs, inspectors) is a legitimate editing
  // surface and never clears the field — otherwise clicking the inspector
  // would close the popover mid-review. While a manual draft is being edited
  // (or an AI request is in flight), outside clicks do NOT clear the field,
  // so an in-progress edit is never silently discarded.
  useEffect(() => {
    if (!selectedField) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-inline-ui]")) return;
      // Allow clicks on the field itself (re-selection) and section controls.
      if (target.closest("[data-editable-field]")) return;
      // Only canvas clicks clear the field selection.
      if (!target.closest('[data-testid="preview-content"]')) return;
      // Never discard an in-progress manual edit or active AI request.
      const state = useInlineEditingStore.getState();
      if (state.mode === "editing" || state.mode === "suggesting" || state.mode === "applying") return;
      clearField();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [selectedField, clearField]);

  // Suppress background canvas behavior while editing a field value.
  const interactive = isBusy || mode !== "idle";

  return (
    <div
      data-inline-layer
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-40"
    >
      {selectedField && !interactive && (
        <div data-inline-ui>
          {/* Toolbar only renders with a real anchor (field clicked in canvas). */}
          {anchorEl && (
            <InlineEditToolbar
              anchor={anchorEl}
              onOpenAiPrompt={() => setAiPromptOpen(!aiPromptOpen)}
              aiPromptOpen={aiPromptOpen}
            />
          )}
          {aiPromptOpen && (
            <div className="pointer-events-none fixed inset-0">
              <div
                className="pointer-events-auto fixed"
                style={{
                  left: "50%",
                  bottom: "4.5rem",
                  transform: "translateX(-50%)",
                }}
              >
                <InlineAiPromptInput onDismiss={() => setAiPromptOpen(false)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suggestion popover — bottom-center */}
      {selectedField && <InlineAiSuggestionPopover />}

      {/* Manual edit overlay — bottom-center */}
      {mode === "editing" && selectedField && (
        <div data-inline-ui>
          <InlineEditOverlay />
        </div>
      )}
    </div>
  );
}

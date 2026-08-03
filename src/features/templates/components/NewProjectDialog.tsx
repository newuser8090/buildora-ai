// ---------------------------------------------------------------------------
// NewProjectDialog — choose a template, name the project, create it
//
// Two-panel single-dialog design:
//   left  — TemplateGallery (search, category tabs, cards)
//   right — selected template summary, project name, Create/Cancel
//
// Guarantees (Phase F):
//   - canonical name validation via validateProjectName() before creation
//   - default name from the selected template, user-editable, trimmed on commit
//   - invalid name blocks creation (error visible, role="alert")
//   - operation state prevents double creation
//   - creation error stays visible; retry does not require reopening
//   - Escape closes when idle, but never interrupts an unsafe creation
//   - full focus trap + focus restoration
//   - creation is announced through a polite live region
// ---------------------------------------------------------------------------

"use client";

import { useState, useCallback, useRef, useEffect, useId } from "react";
import type { BuildoraTemplate } from "../types";
import { TemplateGallery } from "./TemplateGallery";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";

export interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Creates the project. Resolves { ok: true } on success (caller navigates). */
  onCreate: (
    templateId: string,
    projectName: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps) {
  const [selected, setSelected] = useState<BuildoraTemplate | null>(null);
  const [projectName, setProjectName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<BuildoraTemplate | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Mirrors for the stable keydown listener (updated in an effect, never during render).
  const creatingRef = useRef(creating);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  const previewOpenRef = useRef(previewTemplate !== null);

  useEffect(() => {
    creatingRef.current = creating;
    openRef.current = open;
    onCloseRef.current = onClose;
    previewOpenRef.current = previewTemplate !== null;
  }, [creating, open, onClose, previewTemplate]);

  // Reset state when the dialog opens/closes.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      setCreating(false);
      setCreateError(null);
      setPreviewTemplate(null);
    }
    prevOpenRef.current = open;
  }, [open]);

  // Focus management + trap (only while open).
  useEffect(() => {
    if (!open) return;

    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // When the nested preview dialog is open, it owns the focus trap and
      // Escape handling — the parent must not fight it for focus (which would
      // cause a focus-steal loop / stack overflow).
      if (previewOpenRef.current) return;
      if (e.key === "Escape") {
        // Never interrupt an unsafe creation.
        if (creatingRef.current) return;
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active && panelRef.current?.contains(active);

      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!openRef.current) return;
      // Never steal focus away from the nested preview dialog.
      if (previewOpenRef.current) return;
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        getFocusable()[0]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    // Initial focus moves inside the dialog.
    const raf = window.setTimeout(() => {
      getFocusable()[0]?.focus();
    }, 30);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open]);

  // ---- Selection -----------------------------------------------------------

  const handleSelectTemplate = useCallback((template: BuildoraTemplate) => {
    setSelected(template);
    setProjectName(template.defaultName);
    setNameError(null);
    setCreateError(null);
  }, []);

  const handleUseFromPreview = useCallback(
    (template: BuildoraTemplate) => {
      setPreviewTemplate(null);
      handleSelectTemplate(template);
      // Focus the name input for the chosen template.
      window.setTimeout(() => nameInputRef.current?.focus(), 30);
    },
    [handleSelectTemplate],
  );

  // ---- Name ----------------------------------------------------------------

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(e.target.value);
    setNameError(null);
    setCreateError(null);
  }, []);

  // ---- Create --------------------------------------------------------------

  const handleCreate = useCallback(async () => {
    if (creating) return;
    if (!selected) return;

    // Canonical validation BEFORE creation.
    const validation = validateProjectName(projectName);
    if (!validation.valid) {
      setNameError(validation.error ?? "Invalid project name.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    const result = await onCreate(selected.id, projectName.trim());

    setCreating(false);

    if (!result.ok) {
      // Creation error stays visible; retry does not require reopening.
      setCreateError(result.error);
      return;
    }

    // Success — the caller navigates; close the dialog.
    onClose();
  }, [creating, selected, projectName, onCreate, onClose]);

  if (!open) return null;

  const nameValidation = validateProjectName(projectName);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={creating}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-text-primary">
            New Project
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            aria-label="Close new project dialog"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Body — two panels */}
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.2fr_1fr]">
          {/* Left: gallery */}
          <div className="min-h-0 overflow-y-auto border-b border-border px-5 py-4 md:border-b-0 md:border-r">
            <TemplateGallery
              selectedTemplateId={selected?.id ?? null}
              onPreview={(template) => setPreviewTemplate(template)}
              onUse={handleSelectTemplate}
            />
          </div>

          {/* Right: summary + name + actions */}
          <div className="flex min-h-0 flex-col overflow-y-auto px-5 py-4">
            {selected ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">{selected.name}</h3>
                  <p className="mt-1 text-xs text-text-muted">{selected.description}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewTemplate(selected)}
                  className="flex h-8 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary active:scale-95"
                >
                  Preview template
                </button>

                {/* Name field */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="new-project-name"
                    className="text-xs font-medium text-text-dim"
                  >
                    Project name
                  </label>
                  <input
                    ref={nameInputRef}
                    id="new-project-name"
                    type="text"
                    value={projectName}
                    onChange={handleNameChange}
                    maxLength={80}
                    aria-label="Project name"
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? "new-project-name-error" : undefined}
                    disabled={creating}
                    className="h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {nameError && (
                    <p
                      id="new-project-name-error"
                      role="alert"
                      className="text-[11px] text-red-400"
                      data-testid="new-project-name-error"
                    >
                      {nameError}
                    </p>
                  )}
                </div>

                {/* Creation error — stays visible for retry */}
                {createError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                    data-testid="new-project-create-error"
                  >
                    {createError}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-auto flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={creating}
                    className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || !nameValidation.valid || !projectName.trim()}
                    data-testid="create-project-button"
                    className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? (
                      <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                        aria-hidden="true"
                      />
                    ) : (
                      <PlusGlyph />
                    )}
                    {selected.category === "blank" ? "Create Blank Project" : "Create Project"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-text-primary">Choose a template to begin</p>
                <p className="mt-1 text-xs text-text-muted">
                  Or pick Blank to start from an empty page.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Creation status announcement */}
        <div aria-live="polite" className="sr-only" data-testid="new-project-status">
          {creating ? "Creating project..." : ""}
        </div>
      </div>

      {/* Nested preview dialog */}
      <TemplatePreviewDialog
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        onUse={handleUseFromPreview}
      />
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

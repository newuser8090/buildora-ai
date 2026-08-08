// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — SaveAsTemplateDialog
//
// Saves the current project as a reusable personal template. Fields: name,
// description, category, tags. The snapshot is deep-cloned by the service, so
// future project edits never mutate the saved template.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/types/project";
import type { TemplateCategory } from "@/features/templates/types";
import { TEMPLATE_CATEGORY_LABELS } from "@/features/templates/types";
import { validateProjectName } from "@/features/projects/utils/validate-project-name";
import { SAVABLE_TEMPLATE_CATEGORIES } from "../services/personal-template-service";
import type { PersonalTemplateError } from "../types";

export interface SaveAsTemplateDialogProps {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (
    input: {
      name: string;
      description: string;
      category: TemplateCategory;
      tags: string[];
    },
  ) => Promise<{ ok: true } | { ok: false; error: PersonalTemplateError }>;
}

export function SaveAsTemplateDialog({
  open,
  project,
  onClose,
  onSave,
}: SaveAsTemplateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("business");
  const [tagsText, setTagsText] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<PersonalTemplateError | null>(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Reset when the dialog opens with a fresh project.
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && project && project.id !== prevProjectIdRef.current) {
      prevProjectIdRef.current = project.id;
      setName(project.name);
      setDescription("");
      setCategory("business");
      setTagsText("");
      setNameError(null);
      setSaveError(null);
      setSaving(false);
    }
  }, [open, project]);

  // Focus trap + restoration (matches the NewProjectDialog pattern).
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!saving) onClose();
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
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        getFocusable()[0]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    const raf = window.setTimeout(() => getFocusable()[0]?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open, onClose, saving]);

  const handleSave = useCallback(async () => {
    if (saving || !project) return;

    const validation = validateProjectName(name);
    if (!validation.valid) {
      setNameError(validation.error ?? "Enter a name for your template.");
      return;
    }

    setSaving(true);
    setSaveError(null);

    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const result = await onSave({
      name: name.trim(),
      description: description.trim(),
      category,
      tags,
    });

    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    onClose();
  }, [saving, project, name, description, category, tagsText, onSave, onClose]);

  if (!open) return null;

  const nameValidation = validateProjectName(name);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-as-template-title"
    >
      <div
        ref={panelRef}
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="save-as-template-title" tabIndex={-1} className="text-base font-semibold text-text-primary">
            Save as template
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Reuse this project later — your own private template, saved on this device.
          </p>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sat-name" className="text-xs font-medium text-text-dim">
              Template name
            </label>
            <input
              id="sat-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
                setSaveError(null);
              }}
              maxLength={80}
              aria-invalid={nameError ? true : undefined}
              className="h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
            {nameError && (
              <p role="alert" className="text-[11px] text-red-400" data-testid="sat-name-error">
                {nameError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sat-description" className="text-xs font-medium text-text-dim">
              Description{" "}
              <span className="text-text-dim/50">(optional)</span>
            </label>
            <textarea
              id="sat-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaveError(null);
              }}
              rows={2}
              maxLength={200}
              placeholder="What is this template good for?"
              className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sat-category" className="text-xs font-medium text-text-dim">
              Category
            </label>
            <select
              id="sat-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className="h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            >
              {SAVABLE_TEMPLATE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TEMPLATE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="sat-tags" className="text-xs font-medium text-text-dim">
              Tags{" "}
              <span className="text-text-dim/50">(comma-separated, optional)</span>
            </label>
            <input
              id="sat-tags"
              type="text"
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                setSaveError(null);
              }}
              placeholder="wedding, portfolio, cafe"
              className="h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>

          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              data-testid="sat-save-error"
            >
              {saveError.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !nameValidation.valid || !name.trim()}
            data-testid="sat-save-button"
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
            ) : null}
            Save template
          </button>
        </div>
      </div>
    </div>
  );
}

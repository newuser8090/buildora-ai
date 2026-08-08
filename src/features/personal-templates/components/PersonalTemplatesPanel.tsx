// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — PersonalTemplatesPanel
//
// Library of saved personal templates with Use / Preview / Rename /
// Duplicate / Delete. Reuses the existing TemplateCard + TemplatePreviewDialog
// for a consistent experience. Local-only; no marketplace.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Copy, Trash2, Search, X } from "lucide-react";
import type { BuildoraTemplate } from "@/features/templates/types";
import { TemplateCard } from "@/features/templates/components/TemplateCard";
import { TemplatePreviewDialog } from "@/features/templates/components/TemplatePreviewDialog";
import { personalTemplateToBuildoraTemplate } from "../convert/personal-template-converter";
import { getPersonalTemplateService } from "../services/personal-template-service";
import { usePersonalTemplatesUiStore } from "../store/personal-templates-ui-store";
import type { PersonalTemplateRecord } from "../types";
import { cn } from "@/utils/cn";

export interface PersonalTemplatesPanelProps {
  open: boolean;
  onClose: () => void;
  /** Use a template — creates a project. Returns { ok: true } on success. */
  onUse: (
    templateId: string,
    defaultName: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function PersonalTemplatesPanel({
  open,
  onClose,
  onUse,
}: PersonalTemplatesPanelProps) {
  const [templates, setTemplates] = useState<PersonalTemplateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<BuildoraTemplate | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<PersonalTemplateRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PersonalTemplateRecord | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const closeLibrary = usePersonalTemplatesUiStore((s) => s.closeLibrary);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await getPersonalTemplateService().listTemplates();
    setLoading(false);
    if (result.ok) setTemplates(result.templates);
  }, []);

  // Load on open. Deferred in requestAnimationFrame so the list state
  // updates land after the effect (matches the codebase set-state-in-effect
  // pattern — see PublishDialog).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => void refresh());
    return () => cancelAnimationFrame(id);
  }, [open, refresh]);

  // Focus trap + restore (matches the NewProjectDialog pattern).
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
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
  }, [open, onClose]);

  const handleUse = useCallback(
    async (template: PersonalTemplateRecord) => {
      if (usingId) return;
      setUsingId(template.id);
      setActionError(null);
      const result = await onUse(template.id, template.name);
      setUsingId(null);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      closeLibrary();
    },
    [onUse, usingId, closeLibrary],
  );

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget) return;
    const result = await getPersonalTemplateService().renameTemplate(
      renameTarget.id,
      renameValue,
    );
    setRenameTarget(null);
    if (result.ok) {
      await refresh();
    } else {
      setActionError(result.error.message);
    }
  }, [renameTarget, renameValue, refresh]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    const result = await getPersonalTemplateService().deleteTemplate(
      deleteTarget.id,
    );
    setDeleteTarget(null);
    if (result.ok) {
      await refresh();
    } else {
      setActionError(result.error.message);
    }
  }, [deleteTarget, refresh]);

  const filtered = templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
      t.category.toLowerCase().includes(q)
    );
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="personal-templates-title"
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="personal-templates-title" tabIndex={-1} className="text-base font-semibold text-text-primary">
              Your templates
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Start a new project from a saved template — it stays saved on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close your templates"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + actions */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-dim" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your templates..."
              aria-label="Search your templates"
              className="h-9 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>
          <span className="text-xs text-text-dim">
            {templates.length} saved
          </span>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {actionError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              data-testid="personal-templates-error"
            >
              {actionError}
            </div>
          )}

          {loading && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-48 animate-pulse rounded-xl border border-border/60 bg-base" />
              ))}
            </div>
          )}

          {!loading && templates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-base">
                <Copy className="h-6 w-6 text-text-dim" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-text-primary">No saved templates yet</h3>
              <p className="mt-1 max-w-xs text-xs text-text-muted">
                Open any project and choose “Save as template” from its menu. It will show up here.
              </p>
            </div>
          )}

          {!loading && templates.length > 0 && filtered.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-text-primary">No templates found</p>
              <p className="mt-1 text-xs text-text-muted">Try a different search.</p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((template) => {
                const buildora = personalTemplateToBuildoraTemplate(template);
                const busy = usingId === template.id;
                return (
                  <div
                    key={template.id}
                    className={cn("relative", busy && "pointer-events-none opacity-60")}
                    data-testid="personal-template-card"
                  >
                    <TemplateCard
                      template={buildora}
                      onPreview={(t) => setPreview(t)}
                      onUse={() => handleUse(template)}
                      showUse={!busy}
                    />
                    {/* Management actions */}
                    <div className="flex items-center justify-end gap-1 border-t border-border px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setRenameTarget(template);
                          setRenameValue(template.name);
                        }}
                        aria-label={`Rename ${template.name}`}
                        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                      >
                        <Pencil className="h-3 w-3" />
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const result = await getPersonalTemplateService().duplicateTemplate(template.id);
                          if (result.ok) await refresh();
                          else setActionError(result.error.message);
                        }}
                        aria-label={`Duplicate ${template.name}`}
                        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                      >
                        <Copy className="h-3 w-3" />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(template)}
                        aria-label={`Delete ${template.name}`}
                        className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-[11px] text-text-dim/70">
            Up to 25 templates — saved only on this device.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
          >
            Done
          </button>
        </div>
      </div>

      {/* Preview dialog (reuses the template preview) */}
      <TemplatePreviewDialog
        template={preview}
        onClose={() => setPreview(null)}
        onUse={(t) => {
          const record = templates.find((r) => r.id === t.id);
          if (record) {
            setPreview(null);
            void handleUse(record);
          }
        }}
      />

      {/* Rename inline dialog */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Rename ${renameTarget.name}`}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h3 className="text-sm font-semibold text-text-primary">Rename template</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label="Template name"
              autoFocus
              className="mt-3 h-9 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenameConfirm}
                className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${deleteTarget.name}`}
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h3 className="text-sm font-semibold text-text-primary">Delete template?</h3>
            <p className="mt-1 text-xs text-text-muted">
              “{deleteTarget.name}” will be removed from this device. Projects you already made from it are safe.
            </p>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="flex h-9 items-center rounded-lg bg-red-500/90 px-4 text-sm font-medium text-white transition-colors hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

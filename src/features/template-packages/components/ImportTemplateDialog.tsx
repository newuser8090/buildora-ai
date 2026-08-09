// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — ImportTemplateDialog
//
// Beginner-first import surface for .buildora-template packages. Same dialog
// is mounted from the Personal Templates panel and the New Project dialog
// (single implementation — no duplicate importers).
//
// Flow: choose file (picker + drag-drop) → parsing → PREVIEW (metadata only,
// never rendered imported HTML) → Install template / Cancel → installing
// (not dismissible) → success (with optional "Create a project from it") or
// a safe error state.
//
// Guarantees (mirrors ImportProjectDialog / NewProjectDialog):
//   - nothing is persisted until the user confirms Install
//   - a failed import can never leave a half-installed template
//   - Escape closes only when idle / preview / error / success
//   - focus trap + restoration, labelled file input, live-region status
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Upload, FileArchive, X, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { TEMPLATE_CATEGORY_LABELS } from "@/features/templates/types";
import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import { getPersonalTemplateService } from "@/features/personal-templates/services/personal-template-service";
import { markPerf } from "@/features/perf/perf-instrumentation";
import { cn } from "@/utils/cn";
import {
  buildTemplateImportPreview,
  installImportedTemplate,
} from "../services/template-package-importer";
import { mapTemplatePackageErrorToMessage } from "../types";
import type { TemplateImportPreviewInfo } from "../types";

export interface ImportTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful install so the parent can refresh its list. */
  onInstalled?: (record: PersonalTemplateRecord) => void;
  /** Optional: "Create a project from it" action after install. */
  onCreateProject?: (
    templateId: string,
    defaultName: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

type Phase = "idle" | "parsing" | "preview" | "installing" | "success" | "error";

export function ImportTemplateDialog({
  open,
  onClose,
  onInstalled,
  onCreateProject,
}: ImportTemplateDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<TemplateImportPreviewInfo | null>(null);
  const [record, setRecord] = useState<PersonalTemplateRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Mirrors for the stable keydown listener.
  const phaseRef = useRef(phase);
  const creatingRef = useRef(creatingProject);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  // In-flight guards — protect against same-tick double submission (phaseRef
  // lags until the effect runs, so the phase check alone is not airtight).
  const fileInFlightRef = useRef(false);
  const installInFlightRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
    creatingRef.current = creatingProject;
    openRef.current = open;
    onCloseRef.current = onClose;
  }, [phase, creatingProject, open, onClose]);

  const busy = phase === "parsing" || phase === "installing";

  // Reset when closed.
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      setPhase("idle");
      setPreview(null);
      setRecord(null);
      setErrorMessage(null);
      setFileName(null);
      setDragActive(false);
      setCreatingProject(false);
      setCreateProjectError(null);
    }
    prevOpenRef.current = open;
  }, [open]);

  // Focus management + trap (matches the NewProjectDialog pattern).
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Never interrupt a parse/install in flight (refs, never stale closure).
        if (phaseRef.current === "parsing" || phaseRef.current === "installing" || creatingRef.current) {
          return;
        }
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
  }, [open]);

  // ---- File selection -------------------------------------------------------

  const handleFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (fileInFlightRef.current) return;
    if (phaseRef.current === "parsing" || phaseRef.current === "installing") return;
    fileInFlightRef.current = true;
    setPhase("parsing");
    setErrorMessage(null);
    setCreateProjectError(null);
    setFileName(file.name);
    setPreview(null);
    setRecord(null);
    markPerf("template-import-start");

    // Resolve existing template names for conflict-safe naming (best-effort).
    let existingNames: string[] = [];
    try {
      const list = await getPersonalTemplateService().listTemplates();
      if (list.ok) existingNames = list.templates.map((t) => t.name);
    } catch {
      // Conflict resolution degrades to the plain name — never blocks import.
    }

    const result = await buildTemplateImportPreview(file, existingNames);
    markPerf("template-import-end");
    fileInFlightRef.current = false;
    if (!result.ok) {
      setPhase("error");
      setErrorMessage(mapTemplatePackageErrorToMessage(result.error));
      return;
    }
    setPreview(result.preview);
    setRecord(result.record);
    setPhase("preview");
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void handleFile(e.target.files?.[0]);
      e.target.value = "";
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      void handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  // ---- Install ----------------------------------------------------------------

  const handleInstall = useCallback(async () => {
    if (!record) return;
    if (installInFlightRef.current) return;
    if (phaseRef.current !== "preview") return;
    installInFlightRef.current = true;
    setPhase("installing");
    const result = await installImportedTemplate(record);
    installInFlightRef.current = false;
    if (!result.ok) {
      setPhase("error");
      setErrorMessage(mapTemplatePackageErrorToMessage(result.error));
      return;
    }
    setRecord(result.record);
    setPhase("success");
    onInstalled?.(result.record);
  }, [record, onInstalled]);

  const handleCreateProject = useCallback(async () => {
    if (!record || creatingProject) return;
    if (!onCreateProject) return;
    setCreatingProject(true);
    setCreateProjectError(null);
    const result = await onCreateProject(record.id, record.name);
    setCreatingProject(false);
    if (!result.ok) {
      setCreateProjectError(result.error);
      return;
    }
    onClose();
  }, [record, creatingProject, onCreateProject, onClose]);

  const handleChooseAnother = useCallback(() => {
    setPhase("idle");
    setPreview(null);
    setRecord(null);
    setErrorMessage(null);
    setFileName(null);
  }, []);

  if (!open) return null;

  const statusText =
    phase === "parsing"
      ? "Reading template..."
      : phase === "installing"
        ? "Installing template..."
        : "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
        data-testid="template-import-dialog"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-text-primary">
              Import template
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Bring a .buildora-template file from another device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close import template dialog"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === "idle" && (
            <div
              data-testid="template-import-dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
                dragActive
                  ? "border-accent/60 bg-accent/5"
                  : "border-border bg-base",
              )}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card">
                <FileArchive className="h-6 w-6 text-text-dim" />
              </div>
              <p className="mt-3 text-sm font-medium text-text-primary">
                Choose a template package
              </p>
              <p className="mt-1 max-w-xs text-xs text-text-muted">
                Drop a <span className="font-medium text-text-dim">.buildora-template</span>{" "}
                file here, or browse your files.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                data-testid="template-import-choose-file"
                className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
              >
                <Upload className="h-4 w-4" />
                Choose file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".buildora-template"
                aria-label="Choose a template package file"
                data-testid="template-import-file-input"
                className="sr-only"
                onChange={handleInputChange}
              />
            </div>
          )}

          {phase === "parsing" && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span
                className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm text-text-muted">
                Reading <span className="font-medium text-text-primary">{fileName}</span>…
              </p>
            </div>
          )}

          {phase === "preview" && preview && (
            <div data-testid="template-import-preview" className="flex flex-col gap-4">
              <div className="rounded-xl border border-border bg-base p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">{preview.name}</h3>
                    {preview.name !== preview.originalName && (
                      <p className="mt-0.5 text-[11px] text-text-dim">
                        Originally “{preview.originalName}”
                      </p>
                    )}
                  </div>
                  <span className="flex-shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    Format {preview.formatVersion}
                  </span>
                </div>
                {preview.description && (
                  <p className="mt-2 text-xs text-text-muted">{preview.description}</p>
                )}
                <p className="mt-2 text-[11px] text-text-dim">
                  {TEMPLATE_CATEGORY_LABELS[preview.category] ?? preview.category}
                  {preview.tags.length > 0
                    ? ` · ${preview.tags.slice(0, 4).join(", ")}`
                    : ""}
                </p>
              </div>

              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-border bg-base px-2 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-text-dim">Pages</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-text-primary">{preview.pageCount}</dd>
                </div>
                <div className="rounded-lg border border-border bg-base px-2 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-text-dim">Sections</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-text-primary">{preview.sectionCount}</dd>
                </div>
                <div className="rounded-lg border border-border bg-base px-2 py-2.5">
                  <dt className="text-[10px] uppercase tracking-wide text-text-dim">Images</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-text-primary">{preview.assetCount}</dd>
                </div>
              </dl>

              <p className="text-[11px] text-text-dim">
                Package size: {(preview.packageSizeBytes / 1024).toFixed(0)} KB
              </p>

              {preview.warnings.length > 0 && (
                <ul className="flex flex-col gap-1.5" data-testid="template-import-warnings">
                  {preview.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                      <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-400" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleChooseAnother}
                  className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleInstall}
                  data-testid="template-import-install-button"
                  className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
                >
                  Install template
                </button>
              </div>
            </div>
          )}

          {phase === "installing" && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span
                className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent"
                aria-hidden="true"
              />
              <p className="mt-3 text-sm text-text-muted">Installing template…</p>
            </div>
          )}

          {phase === "success" && record && (
            <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="template-import-success">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10">
                <CheckCircle2 className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-text-primary">Template installed</h3>
              <p className="mt-1 text-xs text-text-muted">
                “{record.name}” is now in your templates.
              </p>
              {createProjectError && (
                <p role="alert" className="mt-3 text-xs text-red-400" data-testid="template-import-create-error">
                  {createProjectError}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                >
                  Done
                </button>
                {onCreateProject && (
                  <button
                    type="button"
                    onClick={handleCreateProject}
                    disabled={creatingProject}
                    data-testid="template-import-create-project"
                    className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingProject ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    Create a project from it
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
                <AlertCircle className="h-6 w-6 text-red-400" />
              </div>
              <p role="alert" className="mt-3 text-sm text-red-300" data-testid="template-import-error">
                {errorMessage}
              </p>
              <p className="mt-1 text-[11px] text-text-dim">
                {fileName ? `File: ${fileName}` : "Nothing was changed on this device."}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleChooseAnother}
                  data-testid="template-import-try-another"
                  className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
                >
                  Choose another file
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Status announcement */}
        <div aria-live="polite" className="sr-only" data-testid="template-import-status">
          {statusText}
        </div>
      </div>
    </div>
  );
}

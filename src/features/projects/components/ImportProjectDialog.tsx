// ---------------------------------------------------------------------------
// ImportProjectDialog
//
// Steps through the import flow:
//   1. Idle — shows file picker button
//   2. Reading — FileReader in progress
//   3. Parsing — validating and building preview
//   4. Preview — shows project summary, warnings, name conflict resolution
//   5. Importing — committing to persistence (non-dismissible)
//   6. Error — shows error message with retry
//   7. Success — shows success with optional Open action
//
// Behavior guarantees (Phase E.2):
//   - Custom names are validated with the canonical validateProjectName()
//     BEFORE commit. Invalid values never reach the commit layer.
//   - All three conflict policies (keep / automatic rename / custom name)
//     resolve to an explicit final name at commit time.
//   - Full focus trap: Tab/Shift+Tab wrap, background focus is contained,
//     focus returns to the trigger on close.
//   - Escape is ignored while reading/parsing/importing (an unsafe commit
//     can never be interrupted); after commit failure Escape may close.
//   - Closing the dialog invalidates in-flight operations so stale reads,
//     parses, or commits can never update state or navigate.
//   - Import status / parsing / importing / success are announced through a
//     polite live region; validation errors use role="alert"; file and
//     custom-name errors are associated with their inputs.
// ---------------------------------------------------------------------------

"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Calendar,
  Layers,
  ImageIcon,
  AlertTriangle,
  Info,
  X,
  Download,
  ExternalLink,
} from "lucide-react";
import { readProjectFile } from "../utils/read-project-file";
import { validateProjectName } from "../utils/validate-project-name";
import { ProjectImportService } from "../services/project-import-service";
import type {
  ImportProjectPreview,
  ProjectTransferError,
} from "../types/project-transfer";
import { mapProjectTransferErrorToMessage } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_EXTENSIONS = ".buildora.json,.json,application/json";

/** Error codes that originate from the file itself (associated with the file input). */
const FILE_ERROR_CODES = new Set([
  "FILE_TOO_LARGE",
  "EMPTY_FILE",
  "INVALID_FILE_EXTENSION",
  "FILE_READ_FAILED",
]);

const FILE_ERROR_ID = "import-file-error";
const CUSTOM_NAME_ERROR_ID = "import-custom-name-error";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ImportProjectDialogProps {
  /** Called with the text content of the selected file for parsing. */
  onParse: (text: string, filename: string) => Promise<
    | { ok: true; preview: ImportProjectPreview }
    | { ok: false; error: ProjectTransferError }
  >;
  /** Called to commit the preview. Returns the new project ID on success. */
  onCommit: (
    preview: ImportProjectPreview,
    finalName: string,
  ) => Promise<
    | { ok: true; projectId: string }
    | { ok: false; error: ProjectTransferError }
  >;
  /** List of existing project names for conflict detection. */
  existingNames: string[];
  /** Called when the dialog is closed. */
  onClose: () => void;
  /** Whether the dialog is open. */
  open: boolean;
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

type DialogState =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "parsing" }
  | { phase: "preview"; preview: ImportProjectPreview }
  | { phase: "importing"; preview: ImportProjectPreview; finalName: string }
  | { phase: "success"; projectId: string; projectName: string }
  | {
      phase: "error";
      error: ProjectTransferError;
      retryFile?: { text: string; filename: string };
      retryCommit?: { preview: ImportProjectPreview; finalName: string };
    };

/** Which conflict policy the user selected. */
type NameResolution = "keep" | "rename-auto" | "custom";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImportProjectDialog({
  onParse,
  onCommit,
  existingNames,
  onClose,
  open,
}: ImportProjectDialogProps) {
  const router = useRouter();
  const [state, setState] = useState<DialogState>({ phase: "idle" });
  const [customName, setCustomName] = useState("");
  const [customNameError, setCustomNameError] = useState<string | null>(null);
  const [nameConflict, setNameConflict] = useState(false);
  const [resolution, setResolution] = useState<NameResolution | null>(null);
  const [suggestedName, setSuggestedName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Mount + operation-token protection
  const mountedRef = useRef(true);
  const operationSeqRef = useRef(0);

  // Mirrors of state for event handlers (single stable listener set). Synced
  // with useLayoutEffect (flushed synchronously inside the commit) rather
  // than useEffect, so event handlers and the stable keydown/focusin
  // listeners never read a stale mirror. With an effect-synced mirror there
  // is a window where the committed DOM (observed by a test's waitFor) is
  // ahead of the mirror; a click/keydown in that window is silently dropped
  // by the phase guards, which surfaced as an intermittent full-suite-only
  // test flake.
  const stateRef = useRef(state);
  const resolutionRef = useRef(resolution);
  const customNameRef = useRef(customName);
  const suggestedNameRef = useRef(suggestedName);
  const nameConflictRef = useRef(nameConflict);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    stateRef.current = state;
    resolutionRef.current = resolution;
    customNameRef.current = customName;
    suggestedNameRef.current = suggestedName;
    nameConflictRef.current = nameConflict;
    openRef.current = open;
    onCloseRef.current = onClose;
  });

  // Guards double-commit even before React re-renders
  const importingRef = useRef(false);

  useEffect(() => {
    // StrictMode-safe: re-set on every setup so a dev-mode simulated
    // unmount/remount never permanently flips the guard to false.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const nextToken = useCallback(() => {
    return ++operationSeqRef.current;
  }, []);

  /** Invalidate every in-flight operation (used on close). */
  const invalidateOperations = useCallback(() => {
    operationSeqRef.current++;
  }, []);

  // -----------------------------------------------------------------------
  // Focus management — initial focus, focus trap, restoration
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!open) {
      // Restore focus to the trigger and clean up listeners
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
      return;
    }

    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      const nodes = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return Array.from(nodes);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const s = stateRef.current;
        // An unsafe commit must never be interrupted; reading/parsing are
        // also non-dismissible. Stale completions are still ignored after close.
        if (s.phase === "importing" || s.phase === "reading" || s.phase === "parsing") return;
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

    // Background controls can never retain focus while the dialog is open.
    const handleFocusIn = (e: FocusEvent) => {
      if (!openRef.current) return;
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        const focusable = getFocusable();
        (focusable[0] ?? titleRef.current)?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);

    // Initial focus moves inside the dialog (after paint, for SRs).
    const raf = window.setTimeout(() => titleRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
    };
  }, [open]);

  // -----------------------------------------------------------------------
  // Redirect focus inside the dialog whenever the phase changes to an
  // interactive state (preview / error / success). Without this, the focused
  // element from the previous phase is removed (e.g. the Import button) and
  // focus silently drops to the document body.
  // -----------------------------------------------------------------------

  const prevPhaseRef = useRef(state.phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = state.phase;
    if (!open) return;
    if (state.phase === prev) return;
    // Focus the title on every phase change so focus never silently drops to
    // the document body — including the busy phases (reading/parsing/importing),
    // where the previously focused control has been removed.
    titleRef.current?.focus();
  }, [state.phase, open]);

  // -----------------------------------------------------------------------
  // Reset state + invalidate operations when the dialog closes
  // -----------------------------------------------------------------------

  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      invalidateOperations();
      setState({ phase: "idle" });
      setCustomName("");
      setCustomNameError(null);
      setNameConflict(false);
      setResolution(null);
      setSuggestedName("");
      importingRef.current = false;
    }
    prevOpenRef.current = open;
  }, [open, invalidateOperations]);

  // -----------------------------------------------------------------------
  // File selection
  // -----------------------------------------------------------------------

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input value so re-selecting the SAME file re-fires change.
      e.target.value = "";
      if (!file) return;

      const token = nextToken();

      // Phase: Reading
      setState({ phase: "reading" });

      const readResult = await readProjectFile(file);
      if (!mountedRef.current || token !== operationSeqRef.current) return;

      if (!readResult.ok) {
        setState({
          phase: "error",
          error: readResult.error,
        });
        return;
      }

      // Phase: Parsing
      setState({ phase: "parsing" });

      const parseResult = await onParse(readResult.text, file.name);
      if (!mountedRef.current || token !== operationSeqRef.current) {
        // Stale result — ignored, even if the file read already completed.
        return;
      }

      if (!parseResult.ok) {
        setState({
          phase: "error",
          error: parseResult.error,
          retryFile: { text: readResult.text, filename: file.name },
        });
        return;
      }

      // Phase: Preview
      const preview = parseResult.preview;
      const detectedName = preview.originalProjectName;

      const conflict = existingNames.includes(detectedName);
      setNameConflict(conflict);

      const suggested = conflict
        ? new ProjectImportService().generateUniqueImportName(detectedName, existingNames)
        : "";
      setSuggestedName(suggested);
      setResolution(conflict ? "rename-auto" : null);
      setCustomName("");
      setCustomNameError(null);

      setState({ phase: "preview", preview });
    },
    [onParse, existingNames, nextToken],
  );

  // -----------------------------------------------------------------------
  // Commit (shared by initial import, retry, and import-and-open)
  // -----------------------------------------------------------------------

  const runCommit = useCallback(
    async (preview: ImportProjectPreview, name: string, openAfterImport: boolean) => {
      if (importingRef.current) return;
      importingRef.current = true;

      const token = nextToken();

      // Phase: Importing (non-dismissible)
      setState({ phase: "importing", preview, finalName: name });

      let result: { ok: true; projectId: string } | { ok: false; error: ProjectTransferError };
      try {
        result = await onCommit(preview, name);
      } catch (err) {
        // A rejecting commit must not leave the dialog stuck in the importing
        // state or block retry — reset the guard and surface a structured error.
        importingRef.current = false;
        if (mountedRef.current && token === operationSeqRef.current) {
          setState({
            phase: "error",
            error: {
              code: "IMPORT_SAVE_FAILED",
              message: err instanceof Error ? err.message : "Failed to save imported project.",
              cause: err,
            },
            retryCommit: { preview, finalName: name },
          });
        }
        return;
      }
      importingRef.current = false;
      if (!mountedRef.current || token !== operationSeqRef.current) return;

      if (!result.ok) {
        // Failed commit keeps the dialog open, the selected file, and the
        // conflict resolution intact for retry.
        setState({
          phase: "error",
          error: result.error,
          retryCommit: { preview, finalName: name },
        });
        return;
      }

      // Phase: Success
      setState({
        phase: "success",
        projectId: result.projectId,
        projectName: name,
      });

      if (openAfterImport) {
        try {
          router.push(`/editor/${result.projectId}`);
        } catch {
          // Navigation failure is mapped without duplicating the project —
          // the commit already happened exactly once.
        }
      }
    },
    [onCommit, router, nextToken],
  );

  /** Compute the explicit final name for the selected conflict policy. */
  const resolveFinalName = useCallback(
    (preview: ImportProjectPreview): string => {
      if (!nameConflictRef.current) return preview.originalProjectName;
      if (resolutionRef.current === "keep") return preview.originalProjectName;
      if (resolutionRef.current === "custom") return customNameRef.current.trim();
      return suggestedNameRef.current;
    },
    [],
  );

  // Handle import (both "Import Project" and "Import and Open")
  const handleImport = useCallback(
    async (openAfterImport: boolean) => {
      const s = stateRef.current;
      if (s.phase !== "preview") return;
      if (importingRef.current) return;

      const preview = s.preview;
      const nameToCommit = resolveFinalName(preview);

      // Canonical validation BEFORE commit. Invalid values never reach the
      // commit layer; the selected policy and the custom name are preserved.
      const validation = validateProjectName(nameToCommit);
      if (!validation.valid) {
        setCustomNameError(validation.error ?? "Invalid project name.");
        return;
      }

      setCustomNameError(null);
      await runCommit(preview, nameToCommit, openAfterImport);
    },
    [resolveFinalName, runCommit],
  );

  // -----------------------------------------------------------------------
  // Retry after error
  // -----------------------------------------------------------------------

  const handleRetry = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== "error") return;

    // Commit failure retry — preserve preview, final name, resolution, custom name.
    if (s.retryCommit) {
      await runCommit(s.retryCommit.preview, s.retryCommit.finalName, false);
      return;
    }

    // Parse failure retry — re-parse the retained file content.
    if (s.retryFile) {
      const token = nextToken();
      setState({ phase: "parsing" });

      const parseResult = await onParse(s.retryFile.text, s.retryFile.filename);
      if (!mountedRef.current || token !== operationSeqRef.current) return;

      if (!parseResult.ok) {
        setState({
          phase: "error",
          error: parseResult.error,
          retryFile: s.retryFile,
        });
        return;
      }

      const preview = parseResult.preview;
      const detectedName = preview.originalProjectName;
      const conflict = existingNames.includes(detectedName);
      setNameConflict(conflict);
      const suggested = conflict
        ? new ProjectImportService().generateUniqueImportName(detectedName, existingNames)
        : "";
      setSuggestedName(suggested);
      setResolution(conflict ? "rename-auto" : null);
      setCustomName("");
      setCustomNameError(null);

      setState({ phase: "preview", preview });
    }
  }, [onParse, existingNames, nextToken, runCommit]);

  // -----------------------------------------------------------------------
  // Conflict policy handlers
  // -----------------------------------------------------------------------

  const handleKeepName = useCallback(() => {
    setResolution("keep");
    setCustomNameError(null);
  }, []);

  const handleRenameAuto = useCallback(() => {
    setResolution("rename-auto");
    setCustomNameError(null);
  }, []);

  const handleCustomNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setCustomName(value);
      setResolution("custom");
      // Live-validate so the error clears as soon as the value becomes valid.
      const validation = validateProjectName(value.trim());
      setCustomNameError(validation.valid ? null : (validation.error ?? null));
    },
    [],
  );

  // Reset to idle
  const handleReset = useCallback(() => {
    invalidateOperations();
    setState({ phase: "idle" });
    setCustomName("");
    setCustomNameError(null);
    setNameConflict(false);
    setResolution(null);
    setSuggestedName("");
  }, [invalidateOperations]);

  if (!open) return null;

  // -----------------------------------------------------------------------
  // Render by phase
  // -----------------------------------------------------------------------

  const isBusy = state.phase === "reading" || state.phase === "parsing" || state.phase === "importing";

  const isFileError =
    state.phase === "error" && FILE_ERROR_CODES.has(state.error.code);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
      aria-busy={isBusy}
    >
      <div ref={panelRef} className="w-full max-w-lg rounded-xl border border-border bg-card shadow-elevated">
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
              <Download className="h-4 w-4 text-accent" />
            </div>
            <h2
              ref={titleRef}
              id="import-dialog-title"
              className="text-base font-semibold text-text-primary"
              tabIndex={-1}
            >
              Import Project
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Close dialog"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---- Body ---- */}
        <div className="px-5 py-4">
          {state.phase === "idle" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <Upload className="h-7 w-7 text-accent" />
              </div>
              <p className="text-sm text-text-muted text-center">
                Select a <code className="rounded bg-base px-1 py-0.5 text-xs text-accent">.buildora.json</code> file to import.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
                type="button"
              >
                <Upload className="h-4 w-4" />
                Choose File
              </button>
            </div>
          )}

          {(state.phase === "reading" || state.phase === "parsing") && (
            <div
              className="flex flex-col items-center gap-4 py-12"
              role="status"
              data-testid="import-status"
            >
              <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden="true" />
              <p className="text-sm text-text-muted">
                {state.phase === "reading" ? "Reading file..." : "Validating project..."}
              </p>
            </div>
          )}

          {state.phase === "preview" && (
            <PreviewContent
              preview={state.preview}
              nameConflict={nameConflict}
              suggestedName={suggestedName}
              customName={customName}
              customNameError={customNameError}
              resolution={resolution}
              onResolutionChange={setResolution}
              onCustomNameChange={handleCustomNameChange}
              onKeepName={handleKeepName}
              onRenameAuto={handleRenameAuto}
            />
          )}

          {state.phase === "importing" && (
            <div
              className="flex flex-col items-center gap-4 py-12"
              role="status"
              data-testid="import-status"
            >
              <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden="true" />
              <p className="text-sm text-text-muted">
                Importing project...
              </p>
            </div>
          )}

          {state.phase === "success" && (
            <div
              className="flex flex-col items-center gap-4 py-8"
              role="status"
              data-testid="import-status"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" aria-hidden="true" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">
                  Project imported successfully
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {state.projectName}
                </p>
              </div>
              <button
                onClick={() => router.push(`/editor/${state.projectId}`)}
                className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
                type="button"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                Open in Editor
              </button>
            </div>
          )}

          {state.phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
                <AlertCircle className="h-7 w-7 text-red-400" aria-hidden="true" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-text-primary">
                  Import Failed
                </p>
                <p
                  id={isFileError ? FILE_ERROR_ID : undefined}
                  role="alert"
                  className="mt-1 text-xs text-red-400 max-w-sm"
                >
                  {mapProjectTransferErrorToMessage(state.error)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {(state.retryFile || state.retryCommit) && (
                  <button
                    onClick={handleRetry}
                    className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
                    type="button"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={handleReset}
                  className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary"
                  type="button"
                >
                  Try Different File
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Footer actions ---- */}
        {(state.phase === "idle" || state.phase === "preview") && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            {state.phase === "preview" && (
              <>
                <button
                  onClick={handleReset}
                  disabled={isBusy}
                  className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleImport(false)}
                  disabled={isBusy}
                  className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="import-confirm-button"
                  type="button"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden="true" />
                  )}
                  Import Project
                </button>
                <button
                  onClick={() => handleImport(true)}
                  disabled={isBusy}
                  className="flex h-9 items-center gap-2 rounded-lg bg-primary/10 px-4 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="import-and-open-button"
                  type="button"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  )}
                  Import and Open
                </button>
              </>
            )}
            {state.phase === "idle" && (
              <button
                onClick={onClose}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary"
                type="button"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {state.phase === "success" && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            <button
              onClick={onClose}
              className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary"
              type="button"
            >
              Close
            </button>
          </div>
        )}

        {state.phase === "error" && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            <button
              onClick={onClose}
              className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary"
              type="button"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* ---- File input — kept mounted in every phase so file errors stay
             associated with it via aria-describedby ---- */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        onChange={handleFileSelected}
        className="hidden"
        aria-label="Select a project file to import"
        aria-describedby={isFileError ? FILE_ERROR_ID : undefined}
        data-testid="import-file-input"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview content sub-component
// ---------------------------------------------------------------------------

function PreviewContent({
  preview,
  nameConflict,
  suggestedName,
  customName,
  customNameError,
  resolution,
  onResolutionChange,
  onCustomNameChange,
  onKeepName,
  onRenameAuto,
}: {
  preview: ImportProjectPreview;
  nameConflict: boolean;
  suggestedName: string;
  customName: string;
  customNameError: string | null;
  resolution: NameResolution | null;
  onResolutionChange: (r: NameResolution) => void;
  onCustomNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeepName: (originalName: string) => void;
  onRenameAuto: (suggested: string) => void;
}) {
  const totalSections = preview.project.pages.reduce(
    (sum, p) => sum + p.sections.length,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Project name and metadata */}
      <div className="rounded-lg border border-border bg-base p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
              <h3 className="text-sm font-medium text-text-primary truncate">
                {preview.originalProjectName}
              </h3>
            </div>
            <p className="mt-1 text-xs text-text-dim truncate">
              {preview.sourceFilename}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{preview.project.pages.length} page{preview.project.pages.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{totalSections} section{totalSections !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{preview.project.assets.length} asset{preview.project.assets.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{new Date(preview.project.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Warnings — announced through a polite live region */}
      {preview.warnings.length > 0 && (
        <div
          className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3"
          role="status"
          data-testid="import-warnings"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-yellow-400">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Import Warnings</span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {preview.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-yellow-300/80">
                <Info className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ID regeneration notice */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs text-blue-300">
          <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          This project will be imported as a new project with a fresh ID.
        </p>
      </div>

      {/* Name conflict resolution */}
      {nameConflict && (
        <NameConflictSection
          originalName={preview.originalProjectName}
          suggestedName={suggestedName}
          customName={customName}
          customNameError={customNameError}
          resolution={resolution}
          onResolutionChange={onResolutionChange}
          onCustomNameChange={onCustomNameChange}
          onKeepName={() => onKeepName(preview.originalProjectName)}
          onRenameAuto={() => onRenameAuto(suggestedName)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NameConflictSection — conflict resolution sub-component
// ---------------------------------------------------------------------------

function NameConflictSection({
  originalName,
  suggestedName,
  customName,
  customNameError,
  resolution,
  onResolutionChange,
  onCustomNameChange,
  onKeepName,
  onRenameAuto,
}: {
  originalName: string;
  suggestedName: string;
  customName: string;
  customNameError: string | null;
  resolution: NameResolution | null;
  onResolutionChange: (r: NameResolution) => void;
  onCustomNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeepName: () => void;
  onRenameAuto: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
      role="group"
      aria-label="Name conflict resolution"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Name Conflict</span>
      </div>
      <p className="mt-1 text-xs text-amber-300/80">
        A project named &ldquo;{originalName}&rdquo; already exists. Choose how to resolve:
      </p>

      <div className="mt-3 space-y-2">
        {/* Keep Name */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="name-resolution"
            checked={resolution === "keep"}
            onChange={onKeepName}
            className="mt-0.5 h-3.5 w-3.5 text-accent"
          />
          <div>
            <span className="text-xs font-medium text-amber-200">Keep Name</span>
            <p className="text-[11px] text-amber-300/60 mt-0.5">
              Use &ldquo;{originalName}&rdquo; (two projects may share the name)
            </p>
          </div>
        </label>

        {/* Rename Automatically */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="name-resolution"
            checked={resolution === "rename-auto"}
            onChange={onRenameAuto}
            className="mt-0.5 h-3.5 w-3.5 text-accent"
          />
          <div>
            <span className="text-xs font-medium text-amber-200">Rename Automatically</span>
            <p className="text-[11px] text-amber-300/60 mt-0.5">
              Use &ldquo;{suggestedName}&rdquo;
            </p>
          </div>
        </label>

        {/* Custom Name */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="name-resolution"
            checked={resolution === "custom"}
            onChange={() => onResolutionChange("custom")}
            className="mt-0.5 h-3.5 w-3.5 text-accent"
          />
          <div className="flex-1">
            <span className="text-xs font-medium text-amber-200">Custom Name</span>
            {resolution === "custom" && (
              <div className="mt-1.5">
                <input
                  type="text"
                  value={customName}
                  onChange={onCustomNameChange}
                  placeholder="Enter a name..."
                  className="w-full h-8 rounded-md border border-border bg-base px-2 text-xs text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
                  aria-label="Custom project name"
                  aria-invalid={customNameError ? true : undefined}
                  aria-describedby={customNameError ? CUSTOM_NAME_ERROR_ID : undefined}
                  data-testid="import-custom-name-input"
                />
                {customNameError && (
                  <p
                    id={CUSTOM_NAME_ERROR_ID}
                    role="alert"
                    className="mt-1 text-[11px] text-red-400"
                    data-testid="import-custom-name-error"
                  >
                    {customNameError}
                  </p>
                )}
              </div>
            )}
          </div>
        </label>
      </div>

      {/* Cancel button */}
      <div className="mt-3 pt-2 border-t border-amber-500/10">
        <p className="text-[11px] text-amber-300/50">
          Cancel import to save nothing.
        </p>
      </div>
    </div>
  );
}

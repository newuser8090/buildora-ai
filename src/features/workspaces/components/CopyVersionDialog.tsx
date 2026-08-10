"use client";

// ---------------------------------------------------------------------------
// Phase P15 — CopyVersionDialog
//
// "Create a copy from this version": a fresh project (never the shared one)
// either in the SAME workspace or as a personal project. Fresh identity; no
// collaboration metadata is copied (snapshots are Project-shaped only).
//
// The outer shell renders nothing when closed and mounts the inner surface
// fresh (keyed by version id) on every open — so all form state derives at
// mount, with no reset-from-effect hacks (repo convention, see P14
// WorkspaceSettingsDialog).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, X } from "lucide-react";
import { useWorkspaceHistoryUiStore } from "../store/workspace-history-ui-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import { useProjectVersionHistory } from "../hooks/useProjectVersionHistory";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { notifyActionFeedback } from "@/features/feedback/action-feedback";
import { relativeTime } from "../utils/time";
import { reasonLabel } from "./version-labels";
import type { ProjectVersionMeta } from "../types";

type Destination = "workspace" | "personal";

export function CopyVersionDialog() {
  const copyVersion = useWorkspaceHistoryUiStore((s) => s.copyVersion);
  if (!copyVersion) return null;
  return <CopyVersionDialogInner key={copyVersion.id} version={copyVersion} />;
}

function CopyVersionDialogInner({ version }: { version: ProjectVersionMeta }) {
  const setCopyVersion = useWorkspaceHistoryUiStore((s) => s.setCopyVersion);
  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);
  const role = useWorkspaceAccessStore((s) => s.role);
  const projectId = useEditorStore((s) => s.activeProjectId);
  const projectName = useEditorStore((s) => s.project.name);
  // Copy only needs the version the user clicked (passed in) + the project
  // controller — never the version LIST — so the list fetch stays dormant.
  const { copyToWorkspace, copyToPersonal, openPersonalCopy } = useProjectVersionHistory(
    workspaceId,
    projectId,
    { active: false },
  );

  // Derive initial form state at mount (the inner component remounts per open).
  const [destination, setDestination] = useState<Destination>("workspace");
  const [name, setName] = useState(() => `${projectName} copy`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the name field on mount; Escape closes; focus restored on unmount.
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCopyVersion(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [setCopyVersion]);

  if (!workspaceId || !projectId) return null;

  // Only workspace members with edit access may copy into the workspace.
  const canWorkspaceCopy = role === "owner" || role === "editor";

  const handleCopy = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the copy a name.");
      return;
    }
    setBusy(true);
    setError(null);
    if (destination === "workspace") {
      const result = await copyToWorkspace(version, trimmed);
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? "Couldn't create the copy.");
        return;
      }
      setCopyVersion(null);
      notifyActionFeedback("Copy created in this workspace");
      return;
    }
    const result = await copyToPersonal(version, trimmed);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't create the copy.");
      return;
    }
    setCopyVersion(null);
    if (result.projectId) {
      openPersonalCopy(result.projectId);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Create a copy from this version"
      onClick={() => setCopyVersion(null)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        data-testid="copy-version-dialog"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent/10">
            <Copy className="h-4 w-4 text-accent" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-text-primary">Create a copy</h3>
            <p className="mt-1 text-sm text-text-muted">
              {reasonLabel(version)} · {relativeTime(version.createdAt)} · v
              {version.revision}
            </p>
          </div>
          <button
            onClick={() => setCopyVersion(null)}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <span className="w-24 flex-shrink-0">Destination</span>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value as Destination)}
              disabled={!canWorkspaceCopy}
              data-testid="copy-version-destination"
              className="h-9 flex-1 rounded-lg border border-border bg-base px-2 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
            >
              <option value="workspace">This workspace</option>
              <option value="personal">My projects</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <span className="w-24 flex-shrink-0">Name</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCopy();
              }}
              data-testid="copy-version-name"
              aria-label="Copy name"
              className="h-9 flex-1 rounded-lg border border-border bg-base px-3 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
            />
          </label>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-text-dim">
          The copy gets a fresh identity — it doesn&apos;t share the workspace
          project&apos;s versions, review links, or publishing.
        </p>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => setCopyVersion(null)}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleCopy()}
            disabled={busy}
            data-testid="copy-version-confirm"
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-50"
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Create copy
          </button>
        </div>
      </div>
    </div>
  );
}

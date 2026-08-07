"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — create dialog
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { getCloudProvider } from "@/features/cloud-sync/providers/provider-factory";
import { SharedLibraryService } from "../services/shared-library-service";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";

export interface CreateSharedLibraryDialogProps {
  onCreated: () => void;
}

export function CreateSharedLibraryDialog({ onCreated }: CreateSharedLibraryDialogProps) {
  const open = useSharedLibrariesUiStore((s) => s.createOpen);
  const close = useSharedLibrariesUiStore((s) => s.closeCreate);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(open, dialogRef);

  if (!open) return null;

  const handleCreate = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your shared library a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const provider = getCloudProvider();
    if (!provider) {
      setError("Cloud backup isn't configured for this app yet.");
      setBusy(false);
      return;
    }
    const service = new SharedLibraryService(provider);
    const result = await service.create(trimmed, description.trim() || undefined);
    setBusy(false);
    if (result.ok) {
      setName("");
      setDescription("");
      close();
      onCreated();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-library-title"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-elevated"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="create-library-title" className="text-lg font-semibold text-text-primary">
              New shared library
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Share a private box of saved pieces. Only people you invite can see it.
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="library-name" className="mb-1.5 block text-sm font-medium text-text-primary">
              Name
            </label>
            <input
              id="library-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Team hero sections"
              className="h-10 w-full rounded-lg border border-border bg-base px-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>
          <div>
            <label htmlFor="library-description" className="mb-1.5 block text-sm font-medium text-text-primary">
              Description <span className="text-text-dim">(optional)</span>
            </label>
            <textarea
              id="library-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="What's inside?"
              className="w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-all focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={() => void handleCreate()}
            disabled={busy}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-60"
            type="button"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create library
          </button>
        </div>
      </div>
    </div>
  );
}

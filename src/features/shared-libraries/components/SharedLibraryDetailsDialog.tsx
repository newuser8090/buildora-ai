"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — library details dialog
//
// Shows the library's blocks with previews and "Copy to My Blocks". Copies
// become independent personal records with fresh ids (never live-linked to
// the owner's block).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, Copy, Check, WifiOff, Package, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { getCloudProvider } from "@/features/cloud-sync/providers/provider-factory";
import { SharedLibraryService } from "../services/shared-library-service";
import { copySharedBlockToMyBlocks } from "../services/copy-shared-block";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import { MyBlockPreview } from "@/features/my-blocks/components/MyBlockPreview";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { roleLabel } from "../types";
import { AddBlocksToLibraryDialog } from "./AddBlocksToLibraryDialog";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import {
  getCachedDetails,
  setCachedDetails,
} from "../services/shared-library-cache";
import type {
  CloudSharedLibraryBlock,
  SharedLibraryRole,
} from "@/features/cloud-sync/types";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";

export interface SharedLibraryDetailsDialogProps {
  onChanged: () => void;
}

export function SharedLibraryDetailsDialog({ onChanged }: SharedLibraryDetailsDialogProps) {
  const detailsDialog = useSharedLibrariesUiStore((s) => s.detailsDialog);
  const close = useSharedLibrariesUiStore((s) => s.closeDetails);
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [blocks, setBlocks] = useState<CloudSharedLibraryBlock[]>([]);
  const [name, setName] = useState("");
  const [roleLabelText, setRoleLabelText] = useState("viewer");
  const [memberRole, setMemberRole] = useState<"owner" | SharedLibraryRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const openAddBlocks = useSharedLibrariesUiStore((s) => s.openAddBlocks);

  useFocusTrap(!!detailsDialog, dialogRef);

  // Render-phase reset when the dialog opens (never sync setState in an effect).
  const [prevOpen, setPrevOpen] = useState(!!detailsDialog);
  if (!!detailsDialog !== prevOpen) {
    setPrevOpen(!!detailsDialog);
    if (detailsDialog) {
      setLoading(true);
      setError(null);
      setOffline(false);
    }
  }

  const load = useCallback(() => {
    if (!detailsDialog || !user) return;
    let cancelled = false;
    void (async () => {
      const provider = getCloudProvider();
      if (!provider) {
        setLoading(false);
        setError("Cloud backup isn't configured for this app yet.");
        return;
      }
      const service = new SharedLibraryService(provider);
      const result = await service.details(detailsDialog.libraryId);
      if (cancelled) return;
      setLoading(false);
      if (result.ok && result.value) {
        setBlocks(result.value.blocks);
        setName(result.value.library.name);
        setRoleLabelText(roleLabel(result.value.library.memberRole));
        setMemberRole(result.value.library.memberRole);
        setCachedDetails(user.id, detailsDialog.libraryId, {
          library: result.value.library,
          blocks: result.value.blocks,
        });
      } else {
        const cached = getCachedDetails(user.id, detailsDialog.libraryId);
        if (cached) {
          setBlocks(cached.blocks);
          setName(cached.library.name);
          setRoleLabelText(roleLabel(cached.library.memberRole));
          setMemberRole(cached.library.memberRole);
          setOffline(true);
        } else {
          setError(result.ok ? "That shared library is unavailable." : (result.error?.message ?? "Couldn't load this library."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailsDialog, user]);

  useEffect(() => load(), [load, reloadTick]);

  const canManage = memberRole === "owner" || memberRole === "editor";

  const handleRemove = async (block: CloudSharedLibraryBlock) => {
    if (removingId) return;
    setRemovingId(block.id);
    setError(null);
    const provider = getCloudProvider();
    if (!provider) {
      setError("Cloud backup isn't configured for this app yet.");
      setRemovingId(null);
      return;
    }
    const service = new SharedLibraryService(provider);
    const result = await service.removeBlock(detailsDialog!.libraryId, block.block.id);
    setRemovingId(null);
    if (result.ok) {
      setReloadTick((t) => t + 1);
      onChanged();
    } else {
      setError(result.error.message);
    }
  };

  if (!detailsDialog) return null;

  const handleCopy = async (block: CloudSharedLibraryBlock) => {
    if (copyingId) return;
    setCopyingId(block.id);
    setError(null);
    const provider = getCloudProvider();
    if (!provider) {
      setError("Cloud backup isn't configured for this app yet.");
      setCopyingId(null);
      return;
    }
    const result = await copySharedBlockToMyBlocks(
      { provider, adapter: getMyBlocksAdapter() },
      detailsDialog.libraryId,
      block.block.id,
    );
    setCopyingId(null);
    if (result.ok) {
      setCopiedId(block.id);
      showToast("Copied to your saved pieces.");
      onChanged();
      setTimeout(() => setCopiedId(null), 2000);
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
        aria-labelledby="library-details-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="library-details-title" className="text-lg font-semibold text-text-primary">
              {name || "Shared library"}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Your permission: {roleLabelText}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button
                onClick={() => openAddBlocks(detailsDialog.libraryId)}
                data-testid="library-add-pieces"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover"
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
                Add pieces
              </button>
            )}
            <button
              onClick={close}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {offline && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
              <WifiOff className="h-3.5 w-3.5" />
              Cached preview — access is re-checked when you&apos;re back online.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {loading ? (
            <p className="flex items-center gap-2 py-8 text-center text-sm text-text-dim">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading pieces…
            </p>
          ) : blocks.length === 0 ? (
            <div className="py-10 text-center">
              <Package className="mx-auto h-8 w-8 text-text-dim" />
              <p className="mt-3 text-sm font-medium text-text-primary">No pieces here yet</p>
              <p className="mt-1 text-sm text-text-muted">
                {roleLabelText === "Owner" || roleLabelText === "Can edit"
                  ? "Add pieces from your saved pieces to get started."
                  : "The owner hasn't added any pieces yet."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {blocks.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border bg-card p-3">
                  <MyBlockPreview tree={entry.block.tree} height={104} maxNodes={24} />
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <h4 className="truncate text-sm font-medium text-text-primary">{entry.block.name}</h4>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {canManage && (
                        <button
                          onClick={() => void handleRemove(entry)}
                          disabled={removingId !== null}
                          aria-label={`Remove ${entry.block.name} from this shared library`}
                          data-testid={`library-remove-block-${entry.id}`}
                          className="flex h-8 items-center justify-center rounded-lg border border-border px-2 text-text-dim transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                          type="button"
                        >
                          {removingId === entry.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => void handleCopy(entry)}
                        disabled={copyingId !== null}
                        className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all ${
                          copiedId === entry.id
                            ? "bg-emerald-500/15 text-emerald-400"
                            : "bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
                        }`}
                        type="button"
                      >
                        {copyingId === entry.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : copiedId === entry.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedId === entry.id ? "Copied" : "Copy to My Blocks"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border px-6 py-3 text-xs text-text-dim">
          Copies are independent — if the owner changes the original, your copy stays yours.
        </div>
      </div>

      <AddBlocksToLibraryDialog
        libraryId={detailsDialog.libraryId}
        onAdded={() => {
          setReloadTick((t) => t + 1);
          onChanged();
        }}
      />
    </div>
  );
}

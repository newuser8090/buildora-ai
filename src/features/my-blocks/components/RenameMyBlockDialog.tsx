"use client";

// ---------------------------------------------------------------------------
// RenameMyBlockDialog — rename a saved block
//
// Library metadata only: never touches project history and never renames
// existing inserted copies.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { MY_BLOCK_MAX_NAME_LENGTH } from "../schemas/my-block-schema";
import type { MyBlockRecord } from "../types";

export function RenameMyBlockDialog() {
  const blockId = useMyBlocksUiStore((s) => s.renameBlockId);
  const close = useMyBlocksUiStore((s) => s.closeRename);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [block, setBlock] = useState<MyBlockRecord | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Load the record when opened.
  useEffect(() => {
    if (!blockId) return;
    let cancelled = false;
    getMyBlocksAdapter()
      .getMyBlock(blockId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setBlock(result.value);
          setName(result.value.name);
        } else {
          setError(result.error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blockId]);

  // Focus + Escape.
  useEffect(() => {
    if (!blockId) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", onKey);
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    };
  }, [blockId, saving, close]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!blockId || saving) return;
      const trimmed = name.trim();
      if (!trimmed) {
        setError("Name cannot be empty.");
        return;
      }
      setSaving(true);
      setError(null);
      const result = await getMyBlocksAdapter().updateMyBlock(blockId, { name: trimmed });
      setSaving(false);
      if (result.ok) {
        bumpRefresh();
        showToast(`Renamed to "${result.value.name}"`);
        close();
      } else {
        setError(result.error.message);
      }
    },
    [blockId, saving, name, bumpRefresh, showToast, close],
  );

  if (!blockId) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-my-block-title"
      data-testid="rename-my-block-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) close();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-base p-5 shadow-2xl">
        <h3 id="rename-my-block-title" className="text-sm font-semibold text-text-primary">
          Rename saved block
        </h3>
        <p className="mt-0.5 text-[11px] text-text-dim">
          Renaming only affects your library — inserted copies keep their own names.
        </p>

        {error && !block ? (
          <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4">
            <Input
              ref={inputRef}
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MY_BLOCK_MAX_NAME_LENGTH}
              placeholder="Block name"
              data-testid="rename-my-block-input"
              disabled={saving || !block}
            />
            {error && (
              <p role="alert" data-testid="rename-my-block-error" className="mt-2 text-xs text-red-400">
                {error}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close} disabled={saving} data-testid="rename-my-block-cancel">
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !name.trim() || !block}
                isLoading={saving}
                data-testid="rename-my-block-save"
              >
                Rename
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

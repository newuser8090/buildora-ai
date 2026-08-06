"use client";

// ---------------------------------------------------------------------------
// SaveMyBlockDialog — save a validated native BlockTree as a reusable block
//
// Fields: Name, Description, Category, Tags, Preview, Save.
//   - suggested name from the tree root
//   - duplicate-safe name handling (suggests "Name 2", "Name 3", …)
//   - validation with user-safe messages
//   - keyboard accessible, focus trapped, Escape closes when idle
//   - repeated submit blocked while saving
//   - success toast after save
//   - explicit retention message: "Buildora saves the editable block, not
//     the original code."
//
// Sources: an imported conversion tree, or a persistent custom-block section.
// The tree is always re-validated and deep-cloned by the service layer.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { MY_BLOCK_CATEGORIES } from "../types";
import { saveSectionAsMyBlock, saveTreeAsMyBlock } from "../services/my-blocks-service";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { MyBlockPreview } from "./MyBlockPreview";
import { generateUniqueName } from "../schemas/my-block-schema";
import type { MyBlockCategory } from "../types";

const CATEGORY_LABELS: Record<MyBlockCategory, string> = {
  layout: "Layout",
  text: "Text",
  media: "Media",
  buttons: "Buttons",
  cards: "Cards",
  forms: "Forms",
  navigation: "Navigation",
  "complete-section": "Complete section",
  other: "Other",
};

export function SaveMyBlockDialog() {
  const source = useMyBlocksUiStore((s) => s.saveSource);
  const close = useMyBlocksUiStore((s) => s.closeSaveDialog);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A stale success auto-close timer must never fire after unmount (or it
  // could close a different dialog later).
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  // Editable fields.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MyBlockCategory>("other");
  const [tagsText, setTagsText] = useState("");

  // Reset when the dialog opens with a new source.
  const [prevSourceKey, setPrevSourceKey] = useState<string | null>(null);
  const sourceKey = useMemo(() => {
    if (!source) return null;
    return source.kind === "tree"
      ? `tree:${source.suggestedName}`
      : `section:${source.section.id}`;
  }, [source]);

  if (sourceKey !== prevSourceKey) {
    setPrevSourceKey(sourceKey);
    if (source) {
      setSubmitted(false);
      setSaved(false);
      setError(null);
      const suggested =
        source.kind === "tree"
          ? source.suggestedName
          : typeof source.section.props?.name === "string" && source.section.props.name.trim()
            ? source.section.props.name.trim()
            : "Imported design";
      setName(suggested);
      setDescription("");
      setTagsText("");
      setCategory("other");
    }
  }

  const tree = useMemo(() => {
    if (!source) return null;
    return source.kind === "tree" ? source.tree : null;
  }, [source]);

  // Focus trap + Escape.
  useEffect(() => {
    if (!source) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitted) {
        e.preventDefault();
        close();
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", handleKeyDown);
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    };
  }, [source, submitted, close]);

  const parseTags = useCallback((text: string): string[] => {
    return text
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }, []);

  const handleSave = useCallback(async () => {
    if (!source || submitted) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give your saved block a name.");
      return;
    }
    setSubmitted(true);
    setError(null);
    try {
      const adapter = getMyBlocksAdapter();
      const list = await adapter.listMyBlocks();
      const existingNames = list.ok ? list.value.map((b) => b.name) : [];
      const safeName = generateUniqueName(trimmedName, existingNames);

      const result =
        source.kind === "tree"
          ? await saveTreeAsMyBlock(adapter, {
              tree: source.tree,
              name: safeName,
              description: description.trim() || undefined,
              category,
              tags: parseTags(tagsText),
              sourceMetadata: source.sourceMetadata ?? { source: "imported" },
            })
          : await saveSectionAsMyBlock(adapter, source.section, {
              name: safeName,
              description: description.trim() || undefined,
              category,
              tags: parseTags(tagsText),
            });

      if (!result.ok) {
        setError(result.error.message);
        setSubmitted(false);
        return;
      }
      setSaved(true);
      bumpRefresh();
      showToast(`"${result.value.name}" saved to My Blocks`);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        close();
      }, 350);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this block.");
      setSubmitted(false);
    }
  }, [source, submitted, name, description, category, tagsText, parseTags, close, bumpRefresh, showToast]);

  if (!source) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-block-title"
      data-testid="save-my-block-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitted) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid="save-my-block-panel"
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-base shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10">
              <BookmarkPlus className="h-4 w-4 text-accent" aria-hidden="true" />
            </span>
            <div>
              <h3 id="save-block-title" className="text-sm font-semibold text-text-primary">
                Save as My Block
              </h3>
              <p className="text-[11px] text-text-dim">
                Reuse this design in any project, anytime
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="save-block-close"
            disabled={submitted}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {tree && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-dim">Preview</p>
              <MyBlockPreview tree={tree} height={96} maxNodes={40} />
            </div>
          )}

          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Pricing hero"
            data-testid="save-block-name"
            disabled={submitted}
          />

          <div>
            <label htmlFor="save-block-description" className="mb-1.5 block text-xs font-medium text-text-dim">
              Description <span className="text-text-dim/50">(optional)</span>
            </label>
            <Textarea
              id="save-block-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              placeholder="What is this block for?"
              data-testid="save-block-description"
              disabled={submitted}
              className="min-h-[64px] w-full resize-none rounded-lg border border-border bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
            />
          </div>

          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as MyBlockCategory)}
            data-testid="save-block-category"
            disabled={submitted}
            options={MY_BLOCK_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />

          <Input
            label="Tags (comma separated)"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="hero, pricing, landing"
            data-testid="save-block-tags"
            disabled={submitted}
          />

          <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
            <span aria-hidden="true">🔒</span>
            <span data-testid="save-block-retention-note">
              Buildora saves the editable block, not the original code.
            </span>
          </p>

          {error && (
            <p role="alert" data-testid="save-block-error" className="text-xs text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={submitted} data-testid="save-block-cancel">
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={submitted || !name.trim()}
            isLoading={submitted}
            data-testid="save-block-submit"
          >
            {saved ? "Saved ✓" : "Save block"}
          </Button>
        </div>
      </div>
    </div>
  );
}

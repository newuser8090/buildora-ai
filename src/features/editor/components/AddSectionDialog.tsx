// ---------------------------------------------------------------------------
// AddSectionDialog — browse the section library and insert a new section
//
// Guarantees:
//   - opening / searching / previewing creates nothing
//   - a section is only created on final confirmation (Add Section)
//   - generated ID occurs once (factory), repeated Add blocked while busy
//   - insertion position: after/before selected section, start, end
//   - Escape closes when idle, blocked during an active insertion
//   - full focus trap + focus restoration (mirrors NewProjectDialog)
//   - singleton sections show "Already added" and are disabled
//   - dialog remains open on failure; retry supported
// ---------------------------------------------------------------------------

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Search,
  LayoutGrid,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { sectionLibraryRegistry } from "@/features/editor/section-library/registry/section-library-registry";
import {
  filterSectionDefinitions,
  SECTION_CATEGORIES,
  categoryLabel,
} from "@/features/editor/section-library/utils/filter-section-definitions";
import { sortSectionDefinitions } from "@/features/editor/section-library/utils/sort-section-definitions";
import { SectionFactory } from "@/features/editor/section-library/services/section-factory";
import { getSectionTypeLabel } from "@/features/editor/utils/section-labels";
import type { SectionInsertPosition } from "@/features/editor/store/section-structure";
import type { SectionLibraryCategory } from "@/features/editor/section-library/types";
import type { SectionType } from "@/features/editor/section-library/types";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Lightweight CSS preview model — one visual block per category, no full
// section rendering. Fast for all seven sections, no editor-store hydration.
// ---------------------------------------------------------------------------

function SectionCssPreview({ type }: { type: string }) {
  const blocks = {
    header: ["logo", "links", "links", "links", "cta"],
    hero: ["title", "title", "sub", "cta", "cta"],
    features: ["title", "card", "card", "card"],
    pricing: ["title", "card", "card", "card"],
    faq: ["title", "row", "row", "row"],
    cta: ["title", "sub", "cta"],
    footer: ["logo", "links", "links"],
  } as Record<string, string[]>;

  const layout = blocks[type] ?? ["block", "block", "block"];

  return (
    <div
      className="flex h-16 w-full flex-wrap items-center justify-center gap-1 overflow-hidden rounded-lg border border-border/40 bg-base/60 p-2"
      aria-hidden="true"
    >
      {layout.map((kind, i) => (
        <div
          key={i}
          data-preview-kind={kind}
          className={
            kind === "title"
              ? "h-2 w-3/4 rounded-full bg-accent/50"
              : kind === "sub"
                ? "h-1.5 w-1/2 rounded-full bg-border/50"
                : kind === "cta"
                  ? "h-3 w-6 rounded-md bg-accent/60"
                  : kind === "card"
                    ? "h-8 w-8 rounded-md border border-border/50 bg-card/70"
                    : kind === "row"
                      ? "h-1.5 w-3/4 rounded-full bg-border/40"
                      : kind === "logo"
                        ? "h-2 w-8 rounded-full bg-accent/40"
                        : "h-1.5 w-6 rounded-full bg-border/40"
          }
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface AddSectionDialogProps {
  /** Section currently selected (for before/after positions). */
  selectedSectionId: string | null;
  /** Sections on the active page (for singleton detection). */
  existingSections: BaseSection[];
  /** Active page id (for insertion). */
  pageId: string;
}

export function AddSectionDialog({
  selectedSectionId,
  existingSections,
  pageId,
}: AddSectionDialogProps) {
  const { open, initialType } = useEditorUiStore((s) => s.addSectionDialog);
  const closeAddSectionDialog = useEditorUiStore(
    (s) => s.closeAddSectionDialog,
  );
  const insertSection = useEditorStore((s) => s.insertSection);
  const selectSection = useEditorStore((s) => s.selectSection);
  const setRightSidebarTab = useEditorUiStore(
    (s) => s.setRightSidebarTab,
  );

  const setSelectionSource = useEditorUiStore((s) => s.setSelectionSource);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SectionLibraryCategory | "all">("all");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [position, setPosition] = useState<SectionInsertPosition>({
    type: "end",
  });
  const [inserting, setInserting] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const insertingRef = useRef(inserting);
  const openRef = useRef(open);
  const onCloseRef = useRef(closeAddSectionDialog);

  useEffect(() => {
    insertingRef.current = inserting;
    openRef.current = open;
    onCloseRef.current = closeAddSectionDialog;
  }, [inserting, open, closeAddSectionDialog]);

  // NOTE: the default section library is registered by EditorProvider via
  // useRegisterDefaultSectionLibrary (before any dialog can open), so the
  // registry is populated when this component first renders.

  // Reset state when the dialog opens/closes
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setQuery("");
      setCategory("all");
      setSelectedType(initialType ?? null);
      setPosition(
        selectedSectionId
          ? { type: "after", sectionId: selectedSectionId }
          : { type: "end" },
      );
      setInsertError(null);
      setInserting(false);
    }
    prevOpenRef.current = open;
  }, [open, initialType, selectedSectionId]);

  // Focus trap + Escape + focus restoration (mirrors NewProjectDialog)
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
      if (e.key === "Escape") {
        // Never interrupt an active insertion
        if (insertingRef.current) return;
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

    const raf = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 30);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open]);

  // ---- Derived data ----
  const definitions = useMemo(() => {
    return sortSectionDefinitions(sectionLibraryRegistry.list());
  }, []);

  const filtered = useMemo(() => {
    return filterSectionDefinitions(definitions, {
      query,
      category: category === "all" ? undefined : category,
    });
  }, [definitions, query, category]);

  const existingTypes = useMemo(
    () => new Set(existingSections.map((s) => s.type)),
    [existingSections],
  );

  const hasSelection = selectedSectionId !== null;
  const canBeforeAfter = hasSelection;

  // Position options — re-derive only when selection changes
  const positionOptions = useMemo(() => {
    const options: { value: SectionInsertPosition; label: string }[] = [
      { value: { type: "end" }, label: "End of page" },
      { value: { type: "start" }, label: "Start of page" },
    ];
    if (hasSelection && selectedSectionId) {
      options.unshift(
        { value: { type: "after", sectionId: selectedSectionId }, label: "After selected section" },
        { value: { type: "before", sectionId: selectedSectionId }, label: "Before selected section" },
      );
    }
    return options;
  }, [hasSelection, selectedSectionId]);

  // If the selected section was deleted while the dialog is open, fall back
  const effectivePosition: SectionInsertPosition = useMemo(() => {
    if (position.type === "before" || position.type === "after") {
      if (!hasSelection || !existingSections.some((s) => s.id === position.sectionId)) {
        return { type: "end" };
      }
    }
    return position;
  }, [position, hasSelection, existingSections]);

  const selectedDefinition = definitions.find((d) => d.type === selectedType) ?? null;
  const selectedIsSingleton = selectedDefinition?.singleton ?? false;
  const selectedAlreadyAdded = selectedIsSingleton
    ? existingTypes.has(selectedType ?? "")
    : false;

  // ---- Actions ----

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
      // Keep selection valid
      setSelectedType((prev) =>
        prev && filtered.some((d) => d.type === prev) ? prev : null,
      );
    },
    [filtered],
  );

  const handleAdd = useCallback(async () => {
    if (inserting) return;
    if (!selectedType) return;

    setInserting(true);
    setInsertError(null);

    // Create the validated section (ID generated once, here)
    const factory = new SectionFactory();
    const created = factory.create({
      type: selectedType as SectionType,
      existingIds: new Set(existingSections.map((s) => s.id)),
    });

    if (!created.ok) {
      setInserting(false);
      setInsertError(created.error.message);
      return;
    }

    // Mark the upcoming selection as programmatic so the canvas scrolls the
    // inserted section into view (a stale canvas/structure origin would
    // otherwise suppress the scroll for start/end insertions).
    setSelectionSource(null);

    const result = insertSection(pageId, created.section, effectivePosition);
    setInserting(false);

    if (!result.ok) {
      // Dialog stays open; error visible; retry supported
      setInsertError(result.error.message);
      return;
    }

    // Success — select the inserted section, switch to Design tab once,
    // and close.
    selectSection(created.section.id);
    setRightSidebarTab("design");
    closeAddSectionDialog();
  }, [
    inserting,
    selectedType,
    pageId,
    effectivePosition,
    existingSections,
    insertSection,
    selectSection,
    setSelectionSource,
    setRightSidebarTab,
    closeAddSectionDialog,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-busy={inserting}
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} tabIndex={-1} className="text-base font-semibold text-text-primary">
            Add Section
          </h2>
          <button
            type="button"
            onClick={() => !inserting && closeAddSectionDialog()}
            disabled={inserting}
            aria-label="Close add section dialog"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Search + category */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim/50" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={handleSearchChange}
              placeholder="Search sections…"
              aria-label="Search sections"
              className="h-9 w-full rounded-lg border border-border bg-base pl-9 pr-3 text-sm text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategory("all")}
              aria-pressed={category === "all"}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                category === "all"
                  ? "bg-accent text-white"
                  : "bg-base text-text-dim hover:text-text-primary"
              }`}
            >
              All
            </button>
            {SECTION_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  category === c
                    ? "bg-accent text-white"
                    : "bg-base text-text-dim hover:text-text-primary"
                }`}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>

        {/* Body: cards + right column */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1.3fr_1fr]">
          {/* Cards */}
          <div className="min-h-0 overflow-y-auto border-b border-border px-5 py-4 md:border-b-0 md:border-r">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-text-dim">
                No sections match your search.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {filtered.map((definition) => {
                  const alreadyAdded =
                    definition.singleton && existingTypes.has(definition.type);
                  const isSelected = selectedType === definition.type;
                  return (
                    <button
                      key={definition.type}
                      type="button"
                      data-testid={`section-card-${definition.type}`}
                      aria-pressed={isSelected}
                      aria-disabled={alreadyAdded || undefined}
                      onClick={() => {
                        if (alreadyAdded) return;
                        setSelectedType(definition.type);
                        setInsertError(null);
                      }}
                      className={`flex items-start gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                        alreadyAdded
                          ? "cursor-not-allowed border-border/30 opacity-50"
                          : isSelected
                            ? "border-accent/40 bg-accent/10"
                            : "border-border/40 hover:border-accent/30 hover:bg-base"
                      }`}
                    >
                      <span className="mt-0.5 h-8 w-8 flex-shrink-0">
                        <SectionCssPreview type={definition.type} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">
                            {definition.name}
                          </span>
                          {definition.singleton && (
                            <span className="rounded bg-base px-1 py-px text-[10px] font-medium uppercase tracking-wide text-text-dim/60">
                              Singleton
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-dim">
                          {definition.description}
                        </span>
                        <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-text-dim/50">
                          {categoryLabel(definition.category)}
                        </span>
                        {alreadyAdded && (
                          <span
                            className="mt-1 block text-[11px] font-medium text-accent"
                            data-testid={`already-added-${definition.type}`}
                          >
                            Already added
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected preview + position + actions */}
          <div className="flex min-h-0 flex-col overflow-y-auto px-5 py-4">
            {selectedDefinition ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {selectedDefinition.name}
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">
                    {selectedDefinition.description}
                  </p>
                </div>

                {/* Selected preview */}
                <div className="rounded-lg border border-border/40 bg-base/40 p-2">
                  <SectionCssPreview type={selectedDefinition.type} />
                </div>

                {/* Insertion position */}
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-text-dim">
                    Insert position
                  </legend>
                  <div className="flex flex-col gap-1.5">
                    {positionOptions.map((option) => {
                      const isActive =
                        effectivePosition.type === option.value.type &&
                        (effectivePosition.type !== "before" &&
                        effectivePosition.type !== "after"
                          ? true
                          : effectivePosition.sectionId ===
                            (option.value as { sectionId?: string }).sectionId);
                      return (
                        <label
                          key={`${option.value.type}-${"sectionId" in option.value ? option.value.sectionId : "page"}`}
                          className="flex cursor-pointer items-center gap-2 text-xs text-text-muted"
                        >
                          <input
                            type="radio"
                            name="insert-position"
                            checked={isActive}
                            onChange={() => setPosition(option.value)}
                            disabled={!canBeforeAfter && option.value.type !== "end" && option.value.type !== "start"}
                            className="h-3.5 w-3.5 accent-accent"
                          />
                          {option.value.type === "start" ? (
                            <ArrowUpToLine className="h-3.5 w-3.5 text-text-dim/60" />
                          ) : option.value.type === "end" ? (
                            <ArrowDownToLine className="h-3.5 w-3.5 text-text-dim/60" />
                          ) : (
                            <LayoutGrid className="h-3.5 w-3.5 text-text-dim/60" />
                          )}
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {!hasSelection && (
                  <p className="text-[11px] text-text-dim/60">
                    No section selected — the section will be added to the end of the page.
                  </p>
                )}

                {/* Singleton notice */}
                {selectedAlreadyAdded && (
                  <div
                    role="alert"
                    className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent"
                    data-testid="singleton-exists-notice"
                  >
                    A {getSectionTypeLabel(selectedType!)} already exists on this page. You can
                    select it in the structure panel instead.
                  </div>
                )}

                {/* Insertion error — stays visible for retry */}
                {insertError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                    data-testid="add-section-error"
                  >
                    {insertError}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-auto flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => !inserting && closeAddSectionDialog()}
                    disabled={inserting}
                    className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={inserting || selectedAlreadyAdded}
                    data-testid="confirm-add-section"
                    className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inserting ? (
                      <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                        aria-hidden="true"
                      />
                    ) : null}
                    Add Section
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-text-primary">
                  Select a section to preview
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Pick a card on the left to see a preview and choose where to
                  insert it.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Status announcement */}
        <div aria-live="polite" className="sr-only" data-testid="add-section-status">
          {inserting ? "Adding section…" : ""}
        </div>
      </div>
    </div>
  );
}

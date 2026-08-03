// ---------------------------------------------------------------------------
// PageTabs — browser-style page switcher for the editor
//
// Renders one tab per page below the TopNav:
//   - click to switch pages (clears the section selection)
//   - "+" to add a page (auto-named, immediately enters rename mode)
//   - per-tab action menu: rename / move left / move right / delete
//   - roving-tabindex arrow-key navigation (Left/Right/Home/End)
//
// All mutations flow through the editor store (single history entry each) —
// this component holds only ephemeral UI state (open menu, inline rename).
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { ConfirmDialog } from "@/features/projects/components/ConfirmDialog";
import { cn } from "@/utils/cn";
import type { Page } from "@/types/project";

// ---------------------------------------------------------------------------
// Menu item
// ---------------------------------------------------------------------------

interface MenuItemProps {
  testId: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  ariaDisabledReason?: string;
}

function MenuItem({
  testId,
  icon: Icon,
  label,
  onClick,
  disabled = false,
  danger = false,
  ariaDisabledReason,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      aria-disabled={disabled || undefined}
      aria-label={ariaDisabledReason ?? label}
      title={ariaDisabledReason}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-text-muted hover:bg-base hover:text-text-primary",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PageTabs
// ---------------------------------------------------------------------------

export function PageTabs() {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectPage = useEditorStore((s) => s.selectPage);
  const addPage = useEditorStore((s) => s.addPage);
  const renamePage = useEditorStore((s) => s.renamePage);
  const deletePage = useEditorStore((s) => s.deletePage);
  const movePage = useEditorStore((s) => s.movePage);

  // ---- Ephemeral UI state ----
  const [menuPageId, setMenuPageId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Page | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  // Mirrors renamingId so the onBlur commit handler can ignore stale
  // closures (e.g. a blur racing the Enter/Escape commit that unmounts the
  // input before the re-render flushes).
  const renamingRef = useRef<string | null>(null);

  const activePage =
    project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0];

  // Close the action menu on outside click / Escape
  useEffect(() => {
    if (!menuPageId) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPageId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPageId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuPageId]);

  // Focus + select the rename input when a rename starts
  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const handleSelect = useCallback(
    (pageId: string) => {
      setMenuPageId(null);
      selectPage(pageId);
    },
    [selectPage],
  );

  const handleAdd = useCallback(() => {
    const result = addPage();
    if (!result.ok) return;
    // The store selects the new page — drop straight into rename mode.
    const newPageId = useEditorStore.getState().selectedPageId;
    if (!newPageId) return;
    const page = useEditorStore
      .getState()
      .project.pages.find((p) => p.id === newPageId);
    setMenuPageId(null);
    setRenameError(null);
    renamingRef.current = newPageId;
    setRenamingId(newPageId);
    setRenameValue(page?.title ?? "");
  }, [addPage]);

  const startRename = useCallback((pageId: string) => {
    const page = useEditorStore.getState().project.pages.find(
      (p) => p.id === pageId,
    );
    prevFocusRef.current = document.activeElement as HTMLElement;
    setMenuPageId(null);
    setRenameError(null);
    renamingRef.current = pageId;
    setRenamingId(pageId);
    setRenameValue(page?.title ?? "");
  }, []);

  const cancelRename = useCallback(() => {
    renamingRef.current = null;
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
    prevFocusRef.current?.focus();
    prevFocusRef.current = null;
  }, []);

  const commitRename = useCallback(() => {
    // Ignore stale closures (renamingId from an old render) — the ref is
    // cleared synchronously by cancelRename so a racing blur never commits.
    if (!renamingId || renamingRef.current !== renamingId) return;
    const result = renamePage(renamingId, renameValue);
    if (!result.ok) {
      setRenameError(result.error.message);
      return;
    }
    cancelRename();
  }, [renamingId, renameValue, renamePage, cancelRename]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  const handleMove = useCallback(
    (pageId: string, direction: "left" | "right") => {
      const index = project.pages.findIndex((p) => p.id === pageId);
      const target = direction === "left" ? index - 1 : index + 1;
      if (target < 0 || target >= project.pages.length) return;
      movePage(pageId, target);
      setMenuPageId(null);
    },
    [project.pages, movePage],
  );

  const handleDeleteRequest = useCallback((page: Page) => {
    setMenuPageId(null);
    setDeleteTarget(page);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    deletePage(deleteTarget.id);
    setDeleteTarget(null);
  }, [deleteTarget, deletePage]);

  // Roving-tabindex arrow-key navigation across the page tabs. Arrow keys
  // use automatic activation (matching the RightSidebar TabList convention):
  // they move focus AND select the tab.
  const handleTablistKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "Home" &&
        e.key !== "End"
      ) {
        return;
      }
      const tabs = Array.from(
        e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-page-tab]"),
      );
      const currentIndex = tabs.findIndex(
        (t) => t === document.activeElement,
      );
      if (currentIndex === -1) return;
      let nextIndex = currentIndex;
      if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
      if (e.key === "ArrowLeft")
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") nextIndex = 0;
      if (e.key === "End") nextIndex = tabs.length - 1;
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      nextTab?.focus();
      const nextPageId = nextTab?.getAttribute("data-page-id");
      if (nextPageId) selectPage(nextPageId);
    },
    [selectPage],
  );

  return (
    <>
      <div
        data-testid="page-tabs"
        role="tablist"
        aria-label="Pages"
        onKeyDown={handleTablistKeyDown}
        className="flex h-10 flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-secondary px-3"
      >
        <span className="mr-1.5 hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60 md:inline">
          Pages
        </span>

        {project.pages.map((page, index) => {
          const active = page.id === activePage?.id;
          const isRenaming = renamingId === page.id;
          return (
            <div
              key={page.id}
              data-testid={`page-tab-${page.id}`}
              className={cn(
                "group relative flex h-7 shrink-0 items-center gap-0.5 rounded-lg border px-2 transition-colors duration-200",
                active
                  ? "border-accent/40 bg-card text-text-primary"
                  : "border-transparent bg-transparent text-text-dim hover:bg-card/60 hover:text-text-primary",
              )}
            >
              <button
                type="button"
                role="tab"
                id={`page-tab-button-${page.id}`}
                aria-controls="preview-content"
                data-page-tab
                data-page-id={page.id}
                aria-selected={active}
                aria-label={`Page: ${page.title}`}
                tabIndex={active ? 0 : -1}
                onClick={() => handleSelect(page.id)}
                className="flex min-w-0 items-center gap-1.5 text-xs"
              >
                <FileText className="h-3.5 w-3.5 flex-shrink-0 text-accent/70" />
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    data-testid="page-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={commitRename}
                    aria-label="Page name"
                    className="w-24 rounded border border-accent/40 bg-base px-1.5 py-0.5 text-xs text-text-primary outline-none"
                  />
                ) : (
                  <span className="max-w-[110px] truncate font-medium">
                    {page.title}
                  </span>
                )}
              </button>

              {!isRenaming && (
                <button
                  type="button"
                  data-testid={`page-menu-${page.id}`}
                  aria-label={`Actions for ${page.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuPageId === page.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuPageId(menuPageId === page.id ? null : page.id);
                  }}
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md transition-colors",
                    menuPageId === page.id
                      ? "bg-base text-text-primary"
                      : "text-text-dim/50 opacity-0 hover:text-text-primary group-hover:opacity-100",
                  )}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              )}

              {menuPageId === page.id && (
                <div
                  ref={menuRef}
                  role="menu"
                  data-testid={`page-menu-${page.id}-items`}
                  className="absolute right-0 top-8 z-40 w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-elevated"
                >
                  <MenuItem
                    testId="page-action-rename"
                    icon={Pencil}
                    label="Rename"
                    onClick={() => startRename(page.id)}
                  />
                  <MenuItem
                    testId="page-action-move-left"
                    icon={ArrowLeft}
                    label="Move Left"
                    disabled={index === 0}
                    ariaDisabledReason={
                      index === 0 ? "Already at the left edge" : undefined
                    }
                    onClick={() => handleMove(page.id, "left")}
                  />
                  <MenuItem
                    testId="page-action-move-right"
                    icon={ArrowRight}
                    label="Move Right"
                    disabled={index === project.pages.length - 1}
                    ariaDisabledReason={
                      index === project.pages.length - 1
                        ? "Already at the right edge"
                        : undefined
                    }
                    onClick={() => handleMove(page.id, "right")}
                  />
                  <div className="my-1 h-px bg-border" />
                  <MenuItem
                    testId="page-action-delete"
                    icon={Trash2}
                    label="Delete"
                    danger
                    disabled={project.pages.length <= 1}
                    ariaDisabledReason={
                      project.pages.length <= 1
                        ? "A project must keep at least one page"
                        : undefined
                    }
                    onClick={() => handleDeleteRequest(page)}
                  />
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          data-testid="page-tab-add"
          onClick={handleAdd}
          className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-dashed border-border px-2.5 text-xs text-text-dim transition-all duration-200 hover:border-accent/30 hover:bg-card hover:text-text-primary active:scale-95"
          title="Add page"
          aria-label="Add page"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Add page</span>
        </button>

        {renameError && (
          <span
            data-testid="page-rename-error"
            className="ml-2 shrink-0 truncate text-xs text-red-400"
          >
            {renameError}
          </span>
        )}
      </div>

      {/* ---- Delete confirmation ---- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete page?"
        message={
          deleteTarget
            ? `The page "${deleteTarget.title}" and all of its sections will be permanently removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

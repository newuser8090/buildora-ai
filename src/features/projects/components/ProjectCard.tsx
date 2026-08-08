// ---------------------------------------------------------------------------
// ProjectCard — polished project card with preview placeholder and overflow menu
// ---------------------------------------------------------------------------

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  MoreHorizontal,
  ExternalLink,
  Pencil,
  Copy,
  Pin,
  PinOff,
  Trash2,
  Star,
  Download,
  ImagePlus,
  Archive,
  ArchiveRestore,
  LayoutTemplate,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { formatProjectDate } from "../utils/format-project-date";
import { isSafeDeploymentUrl } from "@/features/publishing/domain/domain-utils";
import type { DashboardProject, DashboardOperation } from "../types";
import type { DashboardPublishInfo } from "@/features/publishing/hooks/useDashboardPublishStatuses";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProjectCardProps {
  project: DashboardProject;
  activeProjectId: string;
  operation: DashboardOperation;
  onOpen: (projectId: string) => void;
  onRename: (projectId: string) => void;
  onDuplicate: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onTogglePin: (projectId: string) => void;
  /** Phase P9 — save this project as a personal template. */
  onSaveAsTemplate?: (project: DashboardProject) => void;
  /** Phase P9 — archive / restore toggle. */
  onToggleArchive?: (projectId: string) => void;
  onExport?: (projectId: string) => void;
  /** Manual thumbnail regeneration (menu action). Optional. */
  onRegeneratePreview?: (projectId: string) => void;
  /** True while this project's thumbnail is being regenerated. */
  isRegeneratingPreview?: boolean;
  /** Phase P7+P8 — derived publish status + optional live URL (local history). */
  publishStatus?: DashboardPublishInfo;
}

// ---------------------------------------------------------------------------
// Deterministic gradient based on project ID
// ---------------------------------------------------------------------------

const GRADIENTS = [
  "from-purple-500/20 to-blue-500/20",
  "from-emerald-500/20 to-teal-500/20",
  "from-amber-500/20 to-orange-500/20",
  "from-rose-500/20 to-pink-500/20",
  "from-cyan-500/20 to-sky-500/20",
  "from-violet-500/20 to-indigo-500/20",
  "from-lime-500/20 to-green-500/20",
  "from-fuchsia-500/20 to-purple-500/20",
];

function getGradient(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = ((hash << 5) - hash) + projectId.charCodeAt(i);
    hash |= 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectCard({
  project,
  activeProjectId,
  operation,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onTogglePin,
  onSaveAsTemplate,
  onToggleArchive,
  onExport,
  onRegeneratePreview,
  isRegeneratingPreview,
  publishStatus,
}: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Reset the failed-image flag whenever the thumbnail URL changes so a
  // regenerated thumbnail (new object URL) can display after a decode error.
  // Done during render (React's "adjusting state when a prop changes"
  // pattern) instead of in an effect — avoids a synchronous setState in an
  // effect body (react-hooks/set-state-in-effect).
  const [prevThumbnailUrl, setPrevThumbnailUrl] = useState(project.thumbnailUrl);
  if (prevThumbnailUrl !== project.thumbnailUrl) {
    setPrevThumbnailUrl(project.thumbnailUrl);
    setImageFailed(false);
  }

  const isActive = project.id === activeProjectId;
  const isOperationTarget =
    operation !== null && "projectId" in operation && operation.projectId === project.id;
  const isDisabled = operation !== null && !isOperationTarget;

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !menuButtonRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Close menu on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    if (menuOpen) {
      window.addEventListener("keydown", handleEscape);
    }
    return () => window.removeEventListener("keydown", handleEscape);
  }, [menuOpen]);

  const handleOpen = useCallback(() => {
    if (!isDisabled) onOpen(project.id);
  }, [project.id, isDisabled, onOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleOpen();
      }
    },
    [handleOpen],
  );

  // ---- Thumbnail state ----
  // ready/stale: show the real image (stale keeps the last valid thumbnail
  //   while regeneration is queued).
  // loading: subtle skeleton on the gradient.
  // missing/error: the deterministic gradient placeholder.
  // ready/stale/error-with-URL: show the real image (stale keeps the last
  // valid thumbnail while regeneration is queued; error keeps an existing
  // thumbnail when one is available, per the documented policy).
  const showImage =
    (project.thumbnailStatus === "ready" ||
      project.thumbnailStatus === "stale" ||
      (project.thumbnailStatus === "error" && !!project.thumbnailUrl)) &&
    !!project.thumbnailUrl &&
    !imageFailed;
  const showSkeleton = project.thumbnailStatus === "loading";

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-all duration-200 hover:border-accent/30 hover:shadow-card cursor-pointer",
        isActive && "ring-1 ring-accent/40",
      )}
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={`Open project ${project.name}`}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
    >
      {/* ---- Preview surface ---- */}
      <div
        className={cn(
          "relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br",
          getGradient(project.id),
        )}
      >
        {/* Real thumbnail (non-interactive — card actions stay on the card). */}
        {showImage && project.thumbnailUrl && (
          <img
            src={project.thumbnailUrl}
            alt={`Preview of ${project.name}`}
            onError={() => setImageFailed(true)}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            data-testid="project-thumbnail"
          />
        )}

        {/* Loading skeleton (subtle) over the gradient. */}
        {showSkeleton && !showImage && (
          <div className="absolute inset-0 animate-pulse bg-white/5" data-testid="thumbnail-skeleton" />
        )}

        {/* Active badge */}
        {isActive && (
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-accent/90 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-current" />
            Active
          </div>
        )}

        {/* Placeholder icon (only when no image is shown). */}
        {!showImage && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
            <ExternalLink className="h-5 w-5 text-white/70" />
          </div>
        )}

        {/* Regenerating badge */}
        {isRegeneratingPreview && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <ImagePlus className="h-2.5 w-2.5 animate-pulse" />
            Regenerating
          </div>
        )}

        {/* Pin indicator */}
        {project.isPinned && (
          <div className="absolute right-2 top-2 z-10 text-yellow-400">
            <Pin className="h-3.5 w-3.5 fill-current" />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
            <ExternalLink className="h-3 w-3" />
            Open
          </span>
        </div>
      </div>

      {/* ---- Card body ---- */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-text-primary truncate flex-1">
            {project.name}
          </h3>

          {/* Overflow menu */}
          <div className="relative flex-shrink-0">
            <button
              ref={menuButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(!menuOpen);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim opacity-0 transition-all duration-200 hover:bg-base hover:text-text-primary group-hover:opacity-100 aria-expanded:opacity-100"
              aria-label={`Menu for ${project.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              type="button"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                className="absolute right-0 top-8 z-40 w-44 rounded-lg border border-border bg-card py-1 shadow-elevated"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { onOpen(project.id); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                  role="menuitem"
                  type="button"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-text-dim" />
                  Open
                </button>
                <button
                  onClick={() => { onRename(project.id); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                  role="menuitem"
                  type="button"
                >
                  <Pencil className="h-3.5 w-3.5 text-text-dim" />
                  Rename
                </button>
                <button
                  onClick={() => { onDuplicate(project.id); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                  role="menuitem"
                  type="button"
                >
                  <Copy className="h-3.5 w-3.5 text-text-dim" />
                  Duplicate
                </button>
                {onSaveAsTemplate && (
                  <>
                    <div className="mx-2 my-1 h-px bg-border" role="separator" />
                    <button
                      onClick={() => { onSaveAsTemplate(project); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                      role="menuitem"
                      type="button"
                    >
                      <LayoutTemplate className="h-3.5 w-3.5 text-text-dim" />
                      Save as template
                    </button>
                  </>
                )}
                <div className="mx-2 my-1 h-px bg-border" role="separator" />
                <button
                  onClick={() => { onTogglePin(project.id); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                  role="menuitem"
                  type="button"
                >
                  {project.isPinned ? (
                    <>
                      <PinOff className="h-3.5 w-3.5 text-text-dim" />
                      Unpin
                    </>
                  ) : (
                    <>
                      <Pin className="h-3.5 w-3.5 text-text-dim" />
                      Pin
                    </>
                  )}
                </button>
                {onRegeneratePreview && (
                  <>
                    <div className="mx-2 my-1 h-px bg-border" role="separator" />
                    <button
                      onClick={() => { onRegeneratePreview(project.id); setMenuOpen(false); }}
                      disabled={isRegeneratingPreview}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
                      role="menuitem"
                      type="button"
                    >
                      <ImagePlus className="h-3.5 w-3.5 text-text-dim" />
                      {isRegeneratingPreview ? "Regenerating…" : "Regenerate Preview"}
                    </button>
                  </>
                )}
                {onExport && (
                  <>
                    <div className="mx-2 my-1 h-px bg-border" role="separator" />
                    <button
                      onClick={() => { onExport(project.id); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                      role="menuitem"
                      type="button"
                    >
                      <Download className="h-3.5 w-3.5 text-text-dim" />
                      Export
                    </button>
                  </>
                )}
                {onToggleArchive && (
                  <>
                    <div className="mx-2 my-1 h-px bg-border" role="separator" />
                    <button
                      onClick={() => { onToggleArchive(project.id); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                      role="menuitem"
                      type="button"
                    >
                      {project.isArchived ? (
                        <>
                          <ArchiveRestore className="h-3.5 w-3.5 text-text-dim" />
                          Restore
                        </>
                      ) : (
                        <>
                          <Archive className="h-3.5 w-3.5 text-text-dim" />
                          Archive
                        </>
                      )}
                    </button>
                  </>
                )}
                <div className="mx-2 my-1 h-px bg-border" role="separator" />
                <button
                  onClick={() => { onDelete(project.id); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                  role="menuitem"
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Phase P7+P8 — publish status (derived, never stored in the project) */}
        {publishStatus && publishStatus.status !== "unknown" && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                publishStatus.status === "live"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : publishStatus.status === "changes-unpublished"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : publishStatus.status === "failed"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : publishStatus.status === "demo-published"
                        ? "bg-accent/10 text-accent"
                        : "bg-card text-text-dim"
              }`}
              data-testid="project-publish-status"
            >
              {publishStatus.status === "live"
                ? "Live"
                : publishStatus.status === "demo-published"
                  ? "Demo published"
                  : publishStatus.status === "published"
                    ? "Published"
                    : publishStatus.status === "changes-unpublished"
                      ? "Changes unpublished"
                      : publishStatus.status === "failed"
                        ? "Publish failed"
                        : "Draft"}
            </span>
            {publishStatus.liveUrl &&
              isSafeDeploymentUrl(publishStatus.liveUrl, publishStatus.providerId ?? "vercel") && (
                <a
                  href={publishStatus.liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-accent transition-colors hover:bg-accent/10"
                  data-testid="project-open-site"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Open site
                </a>
              )}
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-2 text-[11px] text-text-dim/70">
          <span>{formatProjectDate(project.updatedAt)}</span>
          <span className="text-text-dim/30">·</span>
          <span>
            {project.pageCount} page{project.pageCount !== 1 ? "s" : ""}
          </span>
          {project.assetCount > 0 && (
            <>
              <span className="text-text-dim/30">·</span>
              <span>
                {project.assetCount} asset{project.assetCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

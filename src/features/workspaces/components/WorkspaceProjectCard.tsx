"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — WorkspaceProjectCard
//
// Dashboard card for a SERVER-AUTHORITATIVE workspace project. Actions are
// permission-aware (the server remains authoritative):
//   - viewer: Open only (read-only editor)
//   - editor: Open / Edit, Duplicate
//   - owner:  everything above + Delete
//
// The card shows the workspace context and a read-only badge for viewers.
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect } from "react";
import {
  MoreHorizontal,
  ExternalLink,
  Pencil,
  Copy,
  Trash2,
  Eye,
  Shield,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type { WorkspaceProjectSummary } from "../types";

const GRADIENTS = [
  "from-purple-500/20 to-blue-500/20",
  "from-emerald-500/20 to-teal-500/20",
  "from-amber-500/20 to-orange-500/20",
  "from-rose-500/20 to-pink-500/20",
];

function getGradient(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = ((hash << 5) - hash) + projectId.charCodeAt(i);
    hash |= 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export interface WorkspaceProjectCardProps {
  project: WorkspaceProjectSummary;
  role: "owner" | "editor" | "viewer";
  workspaceName: string;
  onOpen: (projectId: string) => void;
  onDuplicate: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  /** True while a global operation is in flight (disable all cards). */
  busy?: boolean;
}

export function WorkspaceProjectCard({
  project,
  role,
  workspaceName,
  onOpen,
  onDuplicate,
  onDelete,
  busy = false,
}: WorkspaceProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !menuButtonRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const canEdit = role === "owner" || role === "editor";
  const canDelete = role === "owner";
  const lastEdited = formatDate(project.updatedAt);

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-all duration-200 hover:border-accent/30 hover:shadow-card cursor-pointer"
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-label={`Open workspace project ${project.name}`}
      onClick={() => {
        if (!busy) onOpen(project.projectId);
      }}
      onKeyDown={(e) => {
        if (busy) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(project.projectId);
        }
      }}
      data-testid={`workspace-project-card-${project.projectId}`}
    >
      {/* Preview surface */}
      <div
        className={cn(
          "relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br",
          getGradient(project.projectId),
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
          <ExternalLink className="h-5 w-5 text-white/70" />
        </div>

        {/* Read-only badge for viewers */}
        {role === "viewer" && (
          <div
            className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
            data-testid="workspace-project-readonly-badge"
          >
            <Eye className="h-2.5 w-2.5" />
            Read-only
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

      {/* Body */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex-1 truncate text-sm font-medium text-text-primary">
            {project.name}
          </h3>

          {busy ? null : (
            <div className="relative flex-shrink-0">
              <button
                ref={menuButtonRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
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
                    onClick={() => {
                      setMenuOpen(false);
                      onOpen(project.projectId);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                    role="menuitem"
                    type="button"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-text-dim" />
                    Open
                  </button>
                  {canEdit && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onOpen(project.projectId);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                      role="menuitem"
                      type="button"
                    >
                      <Pencil className="h-3.5 w-3.5 text-text-dim" />
                      Edit
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onDuplicate(project.projectId);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-primary transition-colors hover:bg-base"
                      role="menuitem"
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5 text-text-dim" />
                      Duplicate
                    </button>
                  )}
                  {canDelete && (
                    <>
                      <div className="mx-2 my-1 h-px bg-border" role="separator" />
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete(project.projectId);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                        role="menuitem"
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Workspace context */}
        <div className="flex items-center gap-1.5 text-[11px] text-text-dim/70">
          <Shield className="h-3 w-3" />
          <span className="truncate">{workspaceName}</span>
        </div>

        {/* Metadata */}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-dim/70">
          <span>Edited {lastEdited}</span>
          <span className="text-text-dim/30">·</span>
          <span className="capitalize">{role}</span>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

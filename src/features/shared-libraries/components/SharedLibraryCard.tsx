"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — library card
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Loader2, Trash2, LogOut, Users, Package, Shield, Pencil, Eye } from "lucide-react";
import type { CloudSharedLibrary } from "@/features/cloud-sync/types";
import { roleLabel } from "../types";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";

interface SharedLibraryCardProps {
  library: CloudSharedLibrary;
  isOwner: boolean;
  onDelete: (library: CloudSharedLibrary) => void;
  onLeave: (library: CloudSharedLibrary) => void;
}

const ROLE_ICONS = {
  owner: Shield,
  editor: Pencil,
  viewer: Eye,
};

export function SharedLibraryCard({ library, isOwner, onDelete, onLeave }: SharedLibraryCardProps) {
  const openDetails = useSharedLibrariesUiStore((s) => s.openDetails);
  const openManage = useSharedLibrariesUiStore((s) => s.openManage);
  const [busy, setBusy] = useState<"delete" | "leave" | null>(null);
  const RoleIcon = ROLE_ICONS[library.memberRole];

  const updatedLabel = new Date(library.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-shadow duration-200 hover:shadow-elevated"
      data-testid="shared-library-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-text-primary">{library.name}</h4>
          {library.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{library.description}</p>
          ) : (
            <p className="mt-0.5 text-xs text-text-dim">A private box of saved pieces</p>
          )}
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isOwner ? "bg-accent/15 text-accent" : "bg-base text-text-dim"
          }`}
          title="Your permission"
        >
          <RoleIcon className="h-3 w-3" />
          {roleLabel(library.memberRole)}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-text-dim">
        <span className="flex items-center gap-1">
          <Package className="h-3.5 w-3.5" />
          {library.blockCount} piece{library.blockCount === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {library.memberCount} member{library.memberCount === 1 ? "" : "s"}
        </span>
        <span className="ml-auto">Updated {updatedLabel}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          onClick={() => openDetails(library.id)}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover"
          type="button"
        >
          Open
        </button>
        {isOwner && (
          <button
            onClick={() => openManage(library.id)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text-primary transition-colors hover:bg-base"
            type="button"
          >
            Manage members
          </button>
        )}
        {!isOwner && (
          <button
            onClick={() => {
              if (busy) return;
              setBusy("leave");
              onLeave(library);
            }}
            disabled={busy === "leave"}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:opacity-50"
            type="button"
          >
            {busy === "leave" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            Leave
          </button>
        )}
        {isOwner && (
          <button
            onClick={() => {
              if (busy) return;
              setBusy("delete");
              onDelete(library);
            }}
            disabled={busy === "delete"}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            type="button"
          >
            {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

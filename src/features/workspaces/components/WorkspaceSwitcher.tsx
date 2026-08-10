"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — WorkspaceSwitcher
//
// The workspace context switcher on the dashboard header. Shows:
//   - "Personal" (default view)
//   - each owned / shared workspace (with role badge)
//   - a pending-invitation count entry (invitations are accepted elsewhere)
//   - "New workspace" (opens the management dialog in create mode)
//   - "Manage" for the selected workspace (opens the management dialog)
//
// Keyboard-accessible: arrow keys navigate, Enter/Space select, Escape closes.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users, ChevronDown, Plus, Check, Settings2, UserPlus } from "lucide-react";
import { useWorkspaceDashboardStore } from "../store/workspace-dashboard-store";
import { cn } from "@/utils/cn";

export interface WorkspaceSwitcherProps {
  /** Opens the management dialog (create mode when workspaceId is null). */
  onManage: (workspaceId: string | null) => void;
  /** Opens the invitations surface. */
  onOpenInvitations: () => void;
}

export function WorkspaceSwitcher({ onManage, onOpenInvitations }: WorkspaceSwitcherProps) {
  const selectedWorkspaceId = useWorkspaceDashboardStore((s) => s.selectedWorkspaceId);
  const owned = useWorkspaceDashboardStore((s) => s.owned);
  const shared = useWorkspaceDashboardStore((s) => s.shared);
  const invitations = useWorkspaceDashboardStore((s) => s.invitations);
  const unavailable = useWorkspaceDashboardStore((s) => s.unavailable);
  const setSelectedWorkspaceId = useWorkspaceDashboardStore((s) => s.setSelectedWorkspaceId);

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const selected =
    selectedWorkspaceId === null
      ? null
      : [...owned, ...shared].find((w) => w.id === selectedWorkspaceId) ?? null;

  // Options list for keyboard navigation: Personal, each workspace, then
  // fixed entries (invitations / new workspace / manage). Memoized so the
  // keydown handler's dependencies stay stable across renders.
  const optionEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      label: string;
      role?: string;
      action: () => void;
    }> = [
      {
        key: "personal",
        label: "Personal",
        action: () => setSelectedWorkspaceId(null),
      },
    ];
    for (const w of owned) {
      entries.push({
        key: w.id,
        label: w.name,
        role: w.memberRole,
        action: () => setSelectedWorkspaceId(w.id),
      });
    }
    for (const w of shared) {
      entries.push({
        key: w.id,
        label: w.name,
        role: w.memberRole,
        action: () => setSelectedWorkspaceId(w.id),
      });
    }
    return entries;
  }, [owned, shared, setSelectedWorkspaceId]);

  const footerEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      label: string;
      icon: "invite" | "plus" | "settings";
      action: () => void;
    }> = [];
    if (invitations.length > 0) {
      entries.push({
        key: "invitations",
        label: `${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}`,
        icon: "invite",
        action: () => {
          setOpen(false);
          onOpenInvitations();
        },
      });
    }
    entries.push({
      key: "new",
      label: "New workspace",
      icon: "plus",
      action: () => {
        setOpen(false);
        onManage(null);
      },
    });
    if (selected) {
      entries.push({
        key: "manage",
        label: "Manage this workspace",
        icon: "settings",
        action: () => {
          setOpen(false);
          onManage(selected.id);
        },
      });
    }
    return entries;
  }, [invitations.length, onOpenInvitations, onManage, selected]);

  const totalOptions = optionEntries.length + footerEntries.length;

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, totalOptions - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (highlighted < optionEntries.length) {
          optionEntries[highlighted].action();
        } else {
          footerEntries[highlighted - optionEntries.length].action();
        }
        setOpen(false);
      }
    },
    [highlighted, optionEntries, footerEntries, totalOptions],
  );

  if (unavailable) {
    // No workspace backend — hide the switcher entirely (personal-only app).
    return null;
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          setHighlighted(0);
        }}
        onKeyDown={handleKeyDown}
        data-testid="workspace-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose where to work"
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-text-primary transition-all duration-200 hover:border-accent/30 hover:bg-accent/5 active:scale-95"
        type="button"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/10">
          <Users className="h-3 w-3 text-accent" />
        </span>
        <span className="max-w-[10rem] truncate">
          {selected ? selected.name : "Personal"}
        </span>
        {invitations.length > 0 && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white"
            aria-label={`${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}`}
          >
            {invitations.length}
          </span>
        )}
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-text-dim transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-11 z-[60] w-64 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-elevated"
        >
          {/* Workspaces */}
          {optionEntries.map((entry, i) => {
            const active = entry.key === "personal" ? selectedWorkspaceId === null : entry.key === selectedWorkspaceId;
            return (
              <button
                key={entry.key}
                role="menuitem"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => {
                  entry.action();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-base",
                  active ? "text-accent" : "text-text-primary",
                  highlighted === i && "bg-base",
                )}
                type="button"
              >
                <Check
                  className={cn("h-3.5 w-3.5 flex-shrink-0", active ? "text-accent" : "text-transparent")}
                />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.role && (
                  <span className="rounded-full bg-base px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-text-dim">
                    {entry.role}
                  </span>
                )}
              </button>
            );
          })}

          {/* Divider */}
          <div className="mx-2 my-1 h-px bg-border" role="separator" />

          {/* Footer entries */}
          {footerEntries.map((entry, i) => {
            const Icon =
              entry.icon === "invite" ? UserPlus : entry.icon === "plus" ? Plus : Settings2;
            return (
              <button
                key={entry.key}
                role="menuitem"
                onMouseEnter={() => setHighlighted(optionEntries.length + i)}
                onClick={() => {
                  entry.action();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-base hover:text-text-primary",
                  highlighted === optionEntries.length + i && "bg-base",
                )}
                type="button"
              >
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-dim" />
                {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

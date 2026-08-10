"use client";

// ---------------------------------------------------------------------------
// Phase P15 — WorkspaceActivityPanel
//
// The shared activity surface. Used by:
//   - the dashboard workspace view (Activity tab) — workspace-wide
//   - the editor version-history dialog (Activity tab) — project-filtered
//
// Events are structured and server-actor-derived; the UI maps types to plain
// sentences (internal type names are never shown). Bounded pagination
// (Load more), category filters, and honest empty/offline states.
// ---------------------------------------------------------------------------

import {
  Activity,
  CopyPlus,
  ExternalLink,
  FolderPlus,
  Globe,
  History,
  Loader2,
  PencilLine,
  Rocket,
  Save,
  Share2,
  ShieldAlert,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useWorkspaceActivity } from "../hooks/useWorkspaceActivity";
import type {
  WorkspaceActivityEvent,
  WorkspaceActivityFilter,
} from "../types";
import { absoluteTime, relativeTime } from "../utils/time";
import { emailToDisplayName } from "../utils/display-name";

export interface WorkspaceActivityPanelProps {
  workspaceId: string;
  /** When set, only events for this project are shown. */
  projectId?: string | null;
  /** projectId → name for readable sentences (missing → "a project"). */
  projectNames?: Record<string, string>;
  /** Compact chrome for embedding inside the editor dialog. */
  compact?: boolean;
  /** Key to force a fresh feed when the project changes. */
  scopeKey?: string;
}

const FILTERS: Array<{ id: WorkspaceActivityFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "projects", label: "Projects" },
  { id: "members", label: "Members" },
  { id: "publishing", label: "Publishing" },
  { id: "sharing", label: "Sharing" },
];

// ---------------------------------------------------------------------------
// Event → human sentence (internal type names are never shown)
// ---------------------------------------------------------------------------

interface EventCopy {
  icon: LucideIcon;
  iconClass: string;
  text: string;
}

function projectName(projectNames: Record<string, string> | undefined, projectId: string | null): string {
  if (!projectId) return "the workspace";
  return projectNames?.[projectId] ?? "a project";
}

function roleLabel(role?: string): string {
  if (!role) return "";
  const lower = role.toLowerCase();
  if (lower === "owner") return "Owner";
  if (lower === "editor") return "Editor";
  return "Viewer";
}

function describeEvent(
  event: WorkspaceActivityEvent,
  projectNames: Record<string, string> | undefined,
): EventCopy {
  const meta = event.metadata;
  const pname = projectName(projectNames, event.projectId);
  switch (event.type) {
    case "workspace.created":
      return { icon: Activity, iconClass: "text-accent", text: "created this workspace" };
    case "workspace.renamed":
      return {
        icon: PencilLine,
        iconClass: "text-text-muted",
        text: `renamed the workspace to "${meta.to ?? ""}"`,
      };
    case "member.invited":
      return {
        icon: UserPlus,
        iconClass: "text-emerald-500",
        text: `invited ${meta.email ?? ""} as ${roleLabel(String(meta.role ?? ""))}`,
      };
    case "member.joined":
      return {
        icon: UserPlus,
        iconClass: "text-emerald-500",
        text: "joined the workspace",
      };
    case "member.role_changed":
      return {
        icon: Users,
        iconClass: "text-text-muted",
        text: `changed ${meta.member ?? "a member"}'s role to ${roleLabel(String(meta.to ?? ""))}`,
      };
    case "member.removed":
      return {
        icon: UserMinus,
        iconClass: "text-red-500",
        text: `removed ${meta.member ?? "a member"}`,
      };
    case "project.created":
      return { icon: FolderPlus, iconClass: "text-accent", text: `created ${pname}` };
    case "project.moved_in":
      return { icon: FolderPlus, iconClass: "text-accent", text: `moved ${pname} into the workspace` };
    case "project.renamed":
      return { icon: PencilLine, iconClass: "text-text-muted", text: `renamed ${pname}` };
    case "project.saved":
      return { icon: Save, iconClass: "text-emerald-500", text: `saved changes to ${pname}` };
    case "project.duplicated":
      return {
        icon: CopyPlus,
        iconClass: "text-text-muted",
        text: `duplicated ${meta.from ?? "a project"} as ${pname}`,
      };
    case "project.deleted":
      return { icon: FolderPlus, iconClass: "text-red-500", text: `deleted ${pname}` };
    case "project.version_created":
      return {
        icon: History,
        iconClass: "text-text-muted",
        text: meta.label
          ? `saved a version of ${pname} — "${meta.label}"`
          : `saved a version of ${pname}`,
      };
    case "project.version_restored":
      return {
        icon: History,
        iconClass: "text-accent",
        text: `restored ${pname} from an older version`,
      };
    case "publish.completed":
      return { icon: Rocket, iconClass: "text-emerald-500", text: `published ${pname}` };
    case "publish.rollback":
      return {
        icon: Rocket,
        iconClass: "text-yellow-500",
        text: `rolled back the last publish of ${pname}`,
      };
    case "share.created":
      return {
        icon: Share2,
        iconClass: "text-emerald-500",
        text: `created a review link for ${pname}`,
      };
    case "share.revoked":
      return {
        icon: Share2,
        iconClass: "text-text-muted",
        text: `revoked a review link for ${pname}`,
      };
    case "domain.attached":
      return {
        icon: Globe,
        iconClass: "text-accent",
        text: `connected ${meta.domain ?? "a domain"} to ${pname}`,
      };
    case "domain.removed":
      return {
        icon: Globe,
        iconClass: "text-text-muted",
        text: `removed ${meta.domain ?? "a domain"} from ${pname}`,
      };
    default:
      return {
        icon: ExternalLink,
        iconClass: "text-text-muted",
        text: "made a change in the workspace",
      };
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function WorkspaceActivityPanel({
  workspaceId,
  projectId = null,
  projectNames,
  compact = false,
  scopeKey,
}: WorkspaceActivityPanelProps) {
  const { events, hasMore, loading, loadingMore, error, filter, setFilter, loadMore } =
    useWorkspaceActivity(workspaceId, { projectId });

  return (
    <div className="flex flex-col" key={scopeKey ?? "activity"}>
      {/* Filters */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter activity">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              data-testid={`activity-filter-${f.id}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === f.id
                  ? "bg-accent/15 text-accent"
                  : "text-text-muted hover:bg-card hover:text-text-primary"
              }`}
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="mt-3" aria-live="polite">
        {loading && events.length === 0 ? (
          <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
          </div>
        ) : error && events.length === 0 ? (
          <div
            data-testid="activity-error"
            className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-300"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center">
            <Activity className="mx-auto h-6 w-6 text-text-dim" />
            <p className="mt-2 text-sm text-text-muted">
              {projectId ? "No activity for this project yet." : "No activity yet."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col" data-testid="activity-list">
            {events.map((event) => {
              const copy = describeEvent(event, projectNames);
              const Icon = copy.icon;
              return (
                <li
                  key={event.id}
                  data-testid="activity-event"
                  className="flex items-start gap-3 border-b border-border/60 px-1 py-3 last:border-b-0"
                >
                  <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-card">
                    <Icon className={`h-3.5 w-3.5 ${copy.iconClass}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">
                      <span className="font-medium">
                        {event.actorName ?? emailToDisplayName("")}
                      </span>{" "}
                      {copy.text}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-dim" title={absoluteTime(event.createdAt)}>
                      {relativeTime(event.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <div className="pt-3 text-center">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              data-testid="activity-load-more"
              className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
              type="button"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

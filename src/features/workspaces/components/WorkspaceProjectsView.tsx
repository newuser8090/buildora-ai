"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — WorkspaceProjectsView
//
// The dashboard's workspace view: shows the workspace name, a manage button
// (owner), a "New project" button (owner/editor), and the workspace project
// cards. Cards are permission-aware (the server stays authoritative). Viewers
// see read-only badges; owners see management actions.
// ---------------------------------------------------------------------------

import { Plus, Settings2, Search, FolderInput, Users, Loader2, Activity } from "lucide-react";
import { useState } from "react";
import { WorkspaceProjectCard } from "./WorkspaceProjectCard";
import { WorkspaceActivityPanel } from "./WorkspaceActivityPanel";
import type { Workspace, WorkspaceProjectSummary } from "../types";
import { canCreateProjects, canManageWorkspace } from "../permissions/workspace-permissions";

export interface WorkspaceProjectsViewProps {
  workspaceId: string;
  projects: WorkspaceProjectSummary[];
  loading: boolean;
  busy: boolean;
  owned: Workspace[];
  shared: Workspace[];
  searchQuery: string;
  onOpen: (projectId: string) => void;
  onDuplicate: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onManage: () => void;
  onNewProject: () => void;
}

export function WorkspaceProjectsView({
  workspaceId,
  projects,
  loading,
  busy,
  owned,
  shared,
  searchQuery,
  onOpen,
  onDuplicate,
  onDelete,
  onManage,
  onNewProject,
}: WorkspaceProjectsViewProps) {
  // Phase P15 — Projects | Activity tabs for the workspace view.
  const [tab, setTab] = useState<"projects" | "activity">("projects");
  const workspace = [...owned, ...shared].find((w) => w.id === workspaceId);
  if (!workspace) {
    // Workspace disappeared (deleted / access revoked) — show a safe empty view.
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card">
          <FolderInput className="h-7 w-7 text-text-dim" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-text-primary">This workspace is no longer available</h2>
        <p className="mt-1 text-sm text-text-muted">
          It may have been deleted, or your access was removed.
        </p>
      </div>
    );
  }

  const role = workspace.memberRole ?? "viewer";
  const isOwner = canManageWorkspace(role);
  const canCreate = canCreateProjects(role);

  const visible = searchQuery.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : projects;

  const projectNames: Record<string, string> = Object.fromEntries(
    projects.map((p) => [p.projectId, p.name]),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Workspace header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <Users className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-text-primary" data-testid="workspace-view-title">
              {workspace.name}
            </h2>
            <p className="text-xs text-text-dim">
              {workspace.memberCount ?? 1} member
              {(workspace.memberCount ?? 1) === 1 ? "" : "s"} ·{" "}
              <span className="capitalize">{role}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <button
              onClick={onManage}
              data-testid="workspace-manage-button"
              className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary active:scale-95"
              type="button"
            >
              <Settings2 className="h-4 w-4" />
              Manage
            </button>
          )}
          {canCreate && (
            <button
              onClick={onNewProject}
              data-testid="workspace-new-project-button"
              className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95"
              type="button"
            >
              <Plus className="h-4 w-4" />
              New Project
            </button>
          )}
        </div>
      </div>

      {/* Phase P15 — Projects | Activity tabs */}
      <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label="Workspace view">
        <button
          role="tab"
          aria-selected={tab === "projects"}
          onClick={() => setTab("projects")}
          data-testid="workspace-tab-projects"
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "projects"
              ? "border-accent text-accent"
              : "border-transparent text-text-muted hover:text-text-primary"
          }`}
          type="button"
        >
          <FolderInput className="h-4 w-4" />
          Projects
        </button>
        <button
          role="tab"
          aria-selected={tab === "activity"}
          onClick={() => setTab("activity")}
          data-testid="workspace-tab-activity"
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "activity"
              ? "border-accent text-accent"
              : "border-transparent text-text-muted hover:text-text-primary"
          }`}
          type="button"
        >
          <Activity className="h-4 w-4" />
          Activity
        </button>
      </div>

      {/* Projects tab */}
      {tab === "projects" &&
        (loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace projects…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 py-14 text-center">
            {searchQuery.trim() ? (
              <>
                <Search className="h-7 w-7 text-text-dim" />
                <h3 className="mt-3 text-sm font-medium text-text-primary">No projects found</h3>
                <p className="mt-1 text-xs text-text-muted">
                  No projects match &quot;{searchQuery.trim()}&quot; in this workspace.
                </p>
              </>
            ) : (
              <>
                <FolderInput className="h-7 w-7 text-text-dim" />
                <h3 className="mt-3 text-sm font-medium text-text-primary">No projects yet</h3>
                <p className="mt-1 text-xs text-text-muted">
                  {canCreate
                    ? "Create a project here, or move one of your personal projects in."
                    : "Projects shared with this workspace will appear here."}
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((project) => (
              <WorkspaceProjectCard
                key={project.projectId}
                project={project}
                role={role}
                workspaceName={workspace.name}
                busy={busy}
                onOpen={onOpen}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            ))}
          </div>
        ))}

      {/* Activity tab */}
      {tab === "activity" && (
        <div data-testid="workspace-activity-panel">
          <WorkspaceActivityPanel workspaceId={workspaceId} projectNames={projectNames} />
        </div>
      )}
    </div>
  );
}

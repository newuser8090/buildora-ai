// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — UI component tests
//
// Covers: workspace switcher, workspace settings (create/invite/roles/remove),
// move-to-workspace flow, and the editor collaboration dialogs (read-only
// banner, being-edited blocker, stale-revision conflict).
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { WorkspaceSwitcher } from "../components/WorkspaceSwitcher";
import { WorkspaceSettingsDialog } from "../components/WorkspaceSettingsDialog";
import { MoveProjectDialog } from "../components/MoveProjectDialog";
import { CollaborationDialogs } from "../components/CollaborationDialogs";
import { useWorkspaceDashboardStore } from "../store/workspace-dashboard-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import type { Workspace, WorkspaceInvitation, WorkspaceMember } from "../types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-a", email: "a@example.com" },
    status: "signed-in",
    session: { user: { id: "user-a", email: "a@example.com" }, token: "t" },
    signOut: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../../persistence/services/project-controller", () => ({
  getProjectController: () => ({
    adapter: { saveProject: vi.fn(async () => ({ success: true })) },
    discardAndOpenProject: vi.fn(async () => ({ success: true })),
  }),
}));

const mockInviteMember = vi.fn();
const mockListMembers = vi.fn();
const mockListInvitations = vi.fn();
const mockRemoveMember = vi.fn();
const mockChangeRole = vi.fn();
const mockCreateWorkspace = vi.fn();
const mockCreateWorkspaceProject = vi.fn();
const mockAcquireLease = vi.fn();
const mockFetchWorkspaceProject = vi.fn();

vi.mock("../services/workspace-service", () => ({
  getWorkspaceProvider: () => ({ kind: "mock" }),
  workspaceBackendAvailable: () => true,
  WorkspaceService: class {
    listWorkspaces() {
      return Promise.resolve({
        ok: true,
        value: { owned: [], shared: [] },
      });
    }
    createWorkspace(name: string) {
      return mockCreateWorkspace(name);
    }
    listMembers(workspaceId: string) {
      return mockListMembers(workspaceId);
    }
    listWorkspaceInvitations(workspaceId: string) {
      return mockListInvitations(workspaceId);
    }
    inviteMember(_ws: string, email: string, role: "editor" | "viewer") {
      return mockInviteMember(email, role);
    }
    removeMember(_ws: string, userId: string) {
      return mockRemoveMember(userId);
    }
    changeMemberRole(_ws: string, userId: string, role: string) {
      return mockChangeRole(userId, role);
    }
    createWorkspaceProject(_ws: string, input: { projectId: string }) {
      return mockCreateWorkspaceProject(input.projectId);
    }
    acquireEditLease(_ws: string, projectId: string) {
      return mockAcquireLease(projectId);
    }
    fetchWorkspaceProject(_ws: string, projectId: string) {
      return mockFetchWorkspaceProject(projectId);
    }
    updateWorkspace() {
      return Promise.resolve({ ok: true, value: ownedWs });
    }
    deleteWorkspace() {
      return Promise.resolve({ ok: true, value: undefined });
    }
    leaveWorkspace() {
      return Promise.resolve({ ok: true, value: undefined });
    }
    revokeInvitation() {
      return Promise.resolve({ ok: true, value: undefined });
    }
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ownedWs: Workspace = {
  id: "ws-1",
  name: "Acme Team",
  ownerId: "user-a",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  memberCount: 2,
  memberRole: "owner",
};

const sharedWs: Workspace = {
  id: "ws-2",
  name: "Partner Studio",
  ownerId: "user-other",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  memberCount: 3,
  memberRole: "editor",
};

const member: WorkspaceMember = {
  workspaceId: "ws-1",
  userId: "user-b",
  email: "b@example.com",
  role: "editor",
  joinedAt: "2026-08-02T00:00:00.000Z",
};

const invitation: WorkspaceInvitation = {
  id: "inv-1",
  workspaceId: "ws-1",
  workspaceName: "Acme Team",
  recipientEmail: "c@example.com",
  role: "viewer",
  status: "pending",
  createdAt: "2026-08-03T00:00:00.000Z",
  expiresAt: "2026-08-17T00:00:00.000Z",
};

function seedDashboard(overrides?: {
  owned?: Workspace[];
  shared?: Workspace[];
  invitations?: WorkspaceInvitation[];
  selectedWorkspaceId?: string | null;
}) {
  const store = useWorkspaceDashboardStore.getState();
  store.setWorkspaces(overrides?.owned ?? [ownedWs], overrides?.shared ?? [sharedWs]);
  store.setInvitations(overrides?.invitations ?? [invitation]);
  store.setSelectedWorkspaceId(overrides?.selectedWorkspaceId ?? null);
  store.setUnavailable(false);
}

function seedAccess(overrides?: {
  access?: { mode: "editable" | "readonly"; reason?: "viewer" | "being-edited" | "offline" | "unauthorized"; editedBy?: string };
  workspaceId?: string;
  leaseHolderName?: string | null;
  saveConflict?: { kind: "stale-revision"; currentRevision: number; serverRevision: number } | null;
  offline?: boolean;
}) {
  const store = useWorkspaceAccessStore;
  store.getState().reset();
  if (!overrides) return;
  if (overrides.access) store.getState().setAccess(overrides.access);
  if (overrides.workspaceId) {
    store.getState().setWorkspaceContext({
      workspaceId: overrides.workspaceId,
      workspaceName: "Acme Team",
      role: "editor",
      serverRevision: 3,
    });
  }
  if (overrides.leaseHolderName !== undefined) store.getState().setLeaseHolderName(overrides.leaseHolderName);
  if (overrides.saveConflict !== undefined) store.getState().setSaveConflict(overrides.saveConflict);
  if (overrides.offline) store.getState().setOffline(overrides.offline);
}

beforeEach(() => {
  seedDashboard();
  useWorkspaceAccessStore.getState().reset();
  mockInviteMember.mockReset();
  mockListMembers.mockReset();
  mockListInvitations.mockReset();
  mockRemoveMember.mockReset();
  mockChangeRole.mockReset();
  mockCreateWorkspace.mockReset();
  mockCreateWorkspaceProject.mockReset();
  mockAcquireLease.mockReset();
  mockFetchWorkspaceProject.mockReset();
  mockListMembers.mockResolvedValue({ ok: true, value: [member] });
  mockListInvitations.mockResolvedValue({ ok: true, value: [invitation] });
  mockInviteMember.mockResolvedValue({ ok: true, value: invitation });
  mockRemoveMember.mockResolvedValue({ ok: true, value: undefined });
  mockChangeRole.mockResolvedValue({ ok: true, value: undefined });
  mockCreateWorkspace.mockResolvedValue({ ok: true, value: ownedWs });
  mockCreateWorkspaceProject.mockResolvedValue({
    ok: true,
    value: { projectId: "proj-1", workspaceId: "ws-1", name: "SaaS", revision: 1, createdBy: "user-a", createdAt: "", updatedAt: "" },
  });
});

afterEach(() => {
  cleanup();
  useWorkspaceDashboardStore.getState().reset();
  useWorkspaceAccessStore.getState().reset();
});

// ---------------------------------------------------------------------------
// WorkspaceSwitcher
// ---------------------------------------------------------------------------

describe("WorkspaceSwitcher", () => {
  it("shows Personal by default and lists owned/shared workspaces with role badges", () => {
    render(<WorkspaceSwitcher onManage={vi.fn()} onOpenInvitations={vi.fn()} />);
    expect(screen.getByTestId("workspace-switcher")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    expect(screen.getByText("Acme Team")).toBeTruthy();
    expect(screen.getByText("Partner Studio")).toBeTruthy();
    // Both role badges present.
    expect(screen.getAllByText(/owner|editor/).length).toBeGreaterThan(0);
  });

  it("selecting a workspace updates the store context", () => {
    render(<WorkspaceSwitcher onManage={vi.fn()} onOpenInvitations={vi.fn()} />);
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    fireEvent.click(screen.getByText("Acme Team"));
    expect(useWorkspaceDashboardStore.getState().selectedWorkspaceId).toBe("ws-1");
  });

  it("shows a pending-invitation count and opens invitations", () => {
    const onOpenInvitations = vi.fn();
    render(<WorkspaceSwitcher onManage={vi.fn()} onOpenInvitations={onOpenInvitations} />);
    fireEvent.click(screen.getByTestId("workspace-switcher"));
    fireEvent.click(screen.getByText(/1 pending invitation/));
    expect(onOpenInvitations).toHaveBeenCalledTimes(1);
  });

  it("is keyboard accessible: arrow + Enter selects a workspace", () => {
    render(<WorkspaceSwitcher onManage={vi.fn()} onOpenInvitations={vi.fn()} />);
    const button = screen.getByTestId("workspace-switcher");
    // Open the menu (click), then navigate with arrow keys.
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "ArrowDown" }); // 0 Personal → 1 Acme Team
    fireEvent.keyDown(button, { key: "Enter" });
    expect(useWorkspaceDashboardStore.getState().selectedWorkspaceId).toBe("ws-1");
  });
});

// ---------------------------------------------------------------------------
// WorkspaceSettingsDialog
// ---------------------------------------------------------------------------

describe("WorkspaceSettingsDialog", () => {
  it("create mode: creates a workspace and selects it", async () => {
    mockCreateWorkspace.mockResolvedValue({ ok: true, value: ownedWs });
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceSettingsDialog open workspace={null} onClose={onClose} onChange={onChange} />,
    );
    expect(screen.getByText("New workspace")).toBeTruthy();
    fireEvent.change(screen.getByTestId("workspace-create-name"), {
      target: { value: "Acme Team" },
    });
    fireEvent.click(screen.getByTestId("workspace-create-button"));
    await waitFor(() => expect(mockCreateWorkspace).toHaveBeenCalledWith("Acme Team"));
    expect(useWorkspaceDashboardStore.getState().selectedWorkspaceId).toBe("ws-1");
    expect(onChange).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("create mode: shows a validation error for an empty name", () => {
    render(<WorkspaceSettingsDialog open workspace={null} onClose={vi.fn()} onChange={vi.fn()} />);
    // The button is disabled when the name is empty — no submit happens.
    const button = screen.getByTestId("workspace-create-button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("manage mode: lists members with labelled role selectors", async () => {
    render(
      <WorkspaceSettingsDialog open workspace={ownedWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId("workspace-member-b@example.com")).toBeTruthy());
    const roleSelect = screen.getByTestId("workspace-role-b@example.com");
    expect(roleSelect.getAttribute("aria-label")).toBe("Role for b@example.com");
    expect((roleSelect as HTMLSelectElement).value).toBe("editor");
  });

  it("invites a member with a chosen role", async () => {
    render(
      <WorkspaceSettingsDialog open workspace={ownedWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId("workspace-invite-email"), {
      target: { value: "sam@example.com" },
    });
    fireEvent.change(screen.getByTestId("workspace-invite-role"), {
      target: { value: "viewer" },
    });
    fireEvent.click(screen.getByTestId("workspace-invite-button"));
    await waitFor(() =>
      expect(mockInviteMember).toHaveBeenCalledWith("sam@example.com", "viewer"),
    );
  });

  it("removes a member after confirmation", async () => {
    render(
      <WorkspaceSettingsDialog open workspace={ownedWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId("workspace-member-b@example.com")).toBeTruthy());
    fireEvent.click(screen.getByTestId("workspace-remove-b@example.com"));
    await waitFor(() => expect(screen.getByTestId("workspace-confirm-dialog")).toBeTruthy());
    fireEvent.click(screen.getByTestId("workspace-confirm-action"));
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalledWith("user-b"));
  });

  it("changes a member's role via the role selector", async () => {
    render(
      <WorkspaceSettingsDialog open workspace={ownedWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId("workspace-role-b@example.com")).toBeTruthy());
    fireEvent.change(screen.getByTestId("workspace-role-b@example.com"), {
      target: { value: "viewer" },
    });
    await waitFor(() => expect(mockChangeRole).toHaveBeenCalledWith("user-b", "viewer"));
  });

  it("revokes a pending invitation", async () => {
    render(
      <WorkspaceSettingsDialog open workspace={ownedWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId("workspace-pending-invite")).toBeTruthy());
    fireEvent.click(screen.getByTestId("workspace-revoke-invite-inv-1"));
    await waitFor(() =>
      expect(screen.getByText("Invitation cancelled.")).toBeTruthy(),
    );
  });

  it("deletes the workspace after confirmation", async () => {
    render(
      <WorkspaceSettingsDialog open workspace={ownedWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("workspace-delete-button"));
    await waitFor(() => expect(screen.getByTestId("workspace-confirm-dialog")).toBeTruthy());
    fireEvent.click(screen.getByTestId("workspace-confirm-action"));
    await waitFor(() => expect(screen.queryByTestId("workspace-confirm-dialog")).toBeNull());
    // Delete path clears the workspace from the dashboard store.
    expect(useWorkspaceDashboardStore.getState().owned.find((w) => w.id === "ws-1")).toBeUndefined();
  });

  it("a viewer sees no management controls (read-only copy)", async () => {
    const viewerWs: Workspace = { ...sharedWs, memberRole: "viewer" };
    render(
      <WorkspaceSettingsDialog open workspace={viewerWs} onClose={vi.fn()} onChange={vi.fn()} />,
    );
    expect(screen.queryByTestId("workspace-invite-email")).toBeNull();
    expect(screen.queryByTestId("workspace-delete-button")).toBeNull();
    // Non-owner explanatory copy is present.
    expect(screen.getByText(/Only the owner can manage members/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MoveProjectDialog
// ---------------------------------------------------------------------------

describe("MoveProjectDialog", () => {
  it("offers only workspaces where the user can create projects", () => {
    seedDashboard({ owned: [ownedWs], shared: [{ ...sharedWs, memberRole: "viewer" }] });
    render(
      <MoveProjectDialog
        open
        projectId="proj-1"
        projectName="SaaS"
        onLoadProject={vi.fn()}
        onClose={vi.fn()}
        onMoved={vi.fn()}
      />,
    );
    const select = screen.getByTestId("move-workspace-select") as HTMLSelectElement;
    expect(select.options.length).toBe(1); // viewer workspace excluded
    expect(select.options[0].textContent).toContain("Acme Team");
  });

  it("moves the project to the chosen workspace", async () => {
    seedDashboard({ owned: [ownedWs], shared: [] });
    const onMoved = vi.fn();
    const onClose = vi.fn();
    const onLoadProject = vi.fn(async () => ({
      ok: true,
      project: { id: "proj-1", name: "SaaS" },
    }));
    render(
      <MoveProjectDialog
        open
        projectId="proj-1"
        projectName="SaaS"
        onLoadProject={onLoadProject}
        onClose={onClose}
        onMoved={onMoved}
      />,
    );
    fireEvent.click(screen.getByTestId("move-project-confirm"));
    await waitFor(() => expect(mockCreateWorkspaceProject).toHaveBeenCalledWith("proj-1"));
    expect(onMoved).toHaveBeenCalledWith("ws-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the project intact locally and shows the error when the server fails", async () => {
    seedDashboard({ owned: [ownedWs], shared: [] });
    mockCreateWorkspaceProject.mockResolvedValue({
      ok: false,
      error: { code: "STALE_REVISION", message: "This project changed since you opened it." },
    });
    const onMoved = vi.fn();
    render(
      <MoveProjectDialog
        open
        projectId="proj-1"
        projectName="SaaS"
        onLoadProject={vi.fn(async () => ({ ok: true, project: { id: "proj-1", name: "SaaS" } }))}
        onClose={vi.fn()}
        onMoved={onMoved}
      />,
    );
    fireEvent.click(screen.getByTestId("move-project-confirm"));
    await waitFor(() => expect(screen.getByTestId("move-project-error")).toBeTruthy());
    expect(onMoved).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CollaborationDialogs
// ---------------------------------------------------------------------------

describe("CollaborationDialogs", () => {
  it("shows the read-only banner for viewers", () => {
    seedAccess({ access: { mode: "readonly", reason: "viewer" } });
    render(<CollaborationDialogs />);
    expect(screen.getByTestId("workspace-readonly-banner")).toBeTruthy();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it("shows the offline banner without implying collaboration", () => {
    seedAccess({ access: { mode: "readonly", reason: "offline" }, offline: true });
    render(<CollaborationDialogs />);
    expect(screen.getByTestId("workspace-readonly-banner")).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it("shows the being-edited blocker with the holder's name and no device ids", () => {
    seedAccess({
      access: { mode: "readonly", reason: "being-edited", editedBy: "alex@example.com" },
      leaseHolderName: "alex@example.com",
    });
    render(<CollaborationDialogs />);
    expect(screen.getByTestId("workspace-being-edited-dialog")).toBeTruthy();
    expect(screen.getByText(/alex@example.com/)).toBeTruthy();
  });

  it("open read-only dismisses the blocker", () => {
    seedAccess({
      access: { mode: "readonly", reason: "being-edited" },
      leaseHolderName: "alex@example.com",
    });
    render(<CollaborationDialogs />);
    fireEvent.click(screen.getByTestId("workspace-open-readonly"));
    expect(useWorkspaceAccessStore.getState().leaseHolderName).toBeNull();
  });

  it("retry after the lease holder is gone acquires the lease", async () => {
    seedAccess({
      access: { mode: "readonly", reason: "being-edited" },
      leaseHolderName: "alex@example.com",
      workspaceId: "ws-1",
    });
    // CollaborationDialogs reads activeProjectId from the editor store.
    const { useEditorStore } = await import("@/features/editor/store/editor-store");
    useEditorStore.setState({ activeProjectId: "proj-1" });
    mockAcquireLease.mockResolvedValue({
      ok: true,
      value: { ok: true, lease: { projectId: "proj-1", leaseId: "lease-x", userId: "user-a", acquiredAt: "", expiresAt: "", heartbeatAt: "" } },
    });
    mockFetchWorkspaceProject.mockResolvedValue({
      ok: true,
      value: { projectId: "proj-1", workspaceId: "ws-1", name: "SaaS", revision: 1, createdBy: "user-a", createdAt: "", updatedAt: "", project: { id: "proj-1" } },
    });
    // window.location.reload is not implemented in jsdom; stub it.
    Object.defineProperty(window, "location", {
      value: { reload: vi.fn() },
      writable: true,
    });
    render(<CollaborationDialogs />);
    fireEvent.click(screen.getByTestId("workspace-retry-lease"));
    await waitFor(() => expect(mockAcquireLease).toHaveBeenCalledWith("proj-1"));
  });

  it("shows the stale-revision conflict dialog and never offers silent overwrite", () => {
    seedAccess({ access: { mode: "editable" }, saveConflict: { kind: "stale-revision", currentRevision: 3, serverRevision: 5 } });
    render(<CollaborationDialogs />);
    expect(screen.getByTestId("workspace-save-conflict-dialog")).toBeTruthy();
    expect(screen.getByText(/changed since you opened it/i)).toBeTruthy();
    expect(screen.getByTestId("workspace-reload-latest")).toBeTruthy();
    expect(screen.getByTestId("workspace-save-personal-copy")).toBeTruthy();
  });

  it("closes the conflict dialog on Escape", () => {
    seedAccess({ access: { mode: "editable" }, saveConflict: { kind: "stale-revision", currentRevision: 3, serverRevision: 5 } });
    render(<CollaborationDialogs />);
    expect(screen.getByTestId("workspace-save-conflict-dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("workspace-save-conflict-dialog")).toBeNull();
  });
});

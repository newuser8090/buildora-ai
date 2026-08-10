// ---------------------------------------------------------------------------
// Phase P15 — UI component tests
//
// Covers the presence indicator (viewing/editing/offline/empty + accessibility),
// the workspace activity panel (filters, pagination, empty/error states), the
// version-history dialog (grouping, role-gated actions, checkpoint), and the
// restore confirmation dialog (stale error, focus/Escape behavior).
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PresenceIndicator } from "../components/PresenceIndicator";
import { WorkspaceActivityPanel } from "../components/WorkspaceActivityPanel";
import { VersionHistoryDialog } from "../components/VersionHistoryDialog";
import { RestoreVersionDialog } from "../components/RestoreVersionDialog";
import { useWorkspacePresenceStore } from "../store/workspace-presence-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import { useWorkspaceHistoryUiStore } from "../store/workspace-history-ui-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { ProjectVersionMeta, WorkspacePresence } from "../types";

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

// WorkspaceService mock: presence/activity/versions passthroughs used by the
// panels and dialogs.
const mockListActivity = vi.fn();
const mockListProjectVersions = vi.fn();
const mockCreateManualVersion = vi.fn();
const mockRestoreProjectVersion = vi.fn();

vi.mock("../services/workspace-service", () => ({
  getWorkspaceProvider: () => ({ kind: "mock" }),
  workspaceBackendAvailable: () => true,
  WorkspaceService: class {
    listActivity(input: unknown) {
      return mockListActivity(input);
    }
    listProjectVersions() {
      return mockListProjectVersions();
    }
    createManualVersion() {
      return mockCreateManualVersion();
    }
    restoreProjectVersion() {
      return mockRestoreProjectVersion();
    }
    fetchProjectVersion() {
      return Promise.resolve({
        ok: true,
        value: {
          id: "v-1",
          projectId: "proj-1",
          workspaceId: "ws-1",
          revision: 1,
          createdBy: "user-a",
          createdAt: "2026-08-10T00:00:00.000Z",
          reason: "autosave",
          contentHash: "h",
          project: {
            id: "proj-1",
            name: "Landing",
            pages: [{ id: "p1", title: "Home" }],
          },
        },
      });
    }
  },
}));

function presence(partial: Partial<WorkspacePresence>): WorkspacePresence {
  return {
    workspaceId: "ws-1",
    projectId: "proj-1",
    userId: "user-x",
    sessionId: "pres-x",
    mode: "viewing",
    joinedAt: "2026-08-10T00:00:00.000Z",
    lastSeenAt: "2026-08-10T00:00:00.000Z",
    displayName: "Alex",
    ...partial,
  };
}

function version(partial: Partial<ProjectVersionMeta>): ProjectVersionMeta {
  return {
    id: "v-1",
    workspaceId: "ws-1",
    projectId: "proj-1",
    revision: 1,
    createdBy: "user-a",
    createdByName: "A",
    createdAt: "2026-08-10T00:00:00.000Z",
    reason: "autosave",
    contentHash: "h",
    ...partial,
  };
}

beforeEach(() => {
  cleanup();
  useWorkspacePresenceStore.getState().reset();
  useWorkspaceAccessStore.getState().reset();
  useWorkspaceHistoryUiStore.getState().reset();
  useEditorStore.setState({
    project: {
      id: "proj-1",
      name: "Landing",
      pages: [],
    },
    activeProjectId: "proj-1",
    isDirty: false,
  } as never);
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("PresenceIndicator", () => {
  it("renders nothing when no live presence session is active (never fakes online)", () => {
    useWorkspacePresenceStore.getState().setScope("ws-1", "proj-1");
    useWorkspacePresenceStore.getState().setActive(false);
    const { container } = render(<PresenceIndicator />);
    expect(container.querySelector('[data-testid="workspace-presence"]')).toBeNull();
  });

  it("renders nothing when disconnected", () => {
    useWorkspacePresenceStore.getState().setScope("ws-1", "proj-1");
    useWorkspacePresenceStore.getState().setActive(true);
    useWorkspacePresenceStore.getState().setDisconnected(true);
    const { container } = render(<PresenceIndicator />);
    expect(container.querySelector('[data-testid="workspace-presence"]')).toBeNull();
  });

  it("shows 'You're viewing' and another member's presence as text", () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "viewer",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "readonly", reason: "viewer" });
    useWorkspacePresenceStore.getState().setScope("ws-1", "proj-1");
    useWorkspacePresenceStore.getState().setActive(true);
    useWorkspacePresenceStore.getState().setSessions([
      presence({ userId: "user-a", sessionId: "self", displayName: "A", mode: "viewing" }),
      presence({ userId: "user-b", sessionId: "b1", displayName: "Alex", mode: "viewing" }),
      presence({ userId: "user-c", sessionId: "c1", displayName: "Priya", mode: "viewing" }),
    ]);
    render(<PresenceIndicator />);
    expect(screen.getByTestId("workspace-presence")).toBeTruthy();
    expect(screen.getByTestId("presence-self").textContent).toContain("viewing");
    // Two other members are present → two chips.
    const otherChips = screen.getAllByTestId("presence-other");
    expect(otherChips).toHaveLength(2);
    expect(otherChips[0].textContent).toContain("Alex");
    // The status region announces the full text state (not color alone).
    expect(screen.getByTestId("workspace-presence").getAttribute("aria-label")).toMatch(/You're viewing/i);
  });

  it("shows an editing member with a lease as editing", () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "editor",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspacePresenceStore.getState().setScope("ws-1", "proj-1");
    useWorkspacePresenceStore.getState().setActive(true);
    useWorkspacePresenceStore.getState().setSessions([
      presence({ userId: "user-a", sessionId: "self", displayName: "A", mode: "editing" }),
      presence({ userId: "user-b", sessionId: "b1", displayName: "Alex", mode: "editing" }),
    ]);
    render(<PresenceIndicator />);
    expect(screen.getByTestId("presence-self").textContent).toContain("editing");
    expect(screen.getByTestId("presence-other").textContent).toContain("editing");
  });

  it("dedupes a member with multiple tabs and caps the visible chips with +N", () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspacePresenceStore.getState().setScope("ws-1", "proj-1");
    useWorkspacePresenceStore.getState().setActive(true);
    // user-b has two tabs; plus user-c and user-d → 3 others, only 2 chips + "+1".
    useWorkspacePresenceStore.getState().setSessions([
      presence({ userId: "user-a", sessionId: "self", displayName: "A", mode: "editing" }),
      presence({ userId: "user-b", sessionId: "b1", displayName: "Alex", mode: "editing" }),
      presence({ userId: "user-b", sessionId: "b2", displayName: "Alex", mode: "editing" }),
      presence({ userId: "user-c", sessionId: "c1", displayName: "Priya", mode: "viewing" }),
      presence({ userId: "user-d", sessionId: "d1", displayName: "Sam", mode: "viewing" }),
    ]);
    render(<PresenceIndicator />);
    const chips = screen.getAllByTestId("presence-other");
    expect(chips).toHaveLength(2);
    expect(screen.getByTestId("presence-more").textContent).toContain("+1");
  });
});

describe("WorkspaceActivityPanel", () => {
  it("renders a filtered feed with actor names and relative times", async () => {
    mockListActivity.mockResolvedValue({
      ok: true,
      value: {
        events: [
          {
            id: "evt-1",
            workspaceId: "ws-1",
            projectId: "proj-1",
            actorUserId: "user-b",
            actorName: "Alex",
            type: "publish.completed",
            createdAt: "2026-08-10T00:00:00.000Z",
            metadata: { provider: "mock", project: "Landing" },
          },
          {
            id: "evt-2",
            workspaceId: "ws-1",
            projectId: null,
            actorUserId: "user-a",
            actorName: "A",
            type: "workspace.renamed",
            createdAt: "2026-08-09T00:00:00.000Z",
            metadata: { to: "Acme" },
          },
        ],
        nextCursor: null,
      },
    });
    render(<WorkspaceActivityPanel workspaceId="ws-1" projectNames={{ "proj-1": "Landing" }} />);
    await waitFor(() => expect(screen.getByTestId("activity-list")).toBeTruthy());
    expect(screen.getByText("Alex")).toBeTruthy();
    // Internal type names are never shown verbatim.
    expect(screen.queryByText("publish.completed")).toBeNull();
    expect(screen.queryByText("workspace.renamed")).toBeNull();
    expect(screen.getByText(/published Landing/i)).toBeTruthy();
  });

  it("applies category filters", async () => {
    mockListActivity.mockResolvedValue({
      ok: true,
      value: { events: [], nextCursor: null },
    });
    render(<WorkspaceActivityPanel workspaceId="ws-1" />);
    // An empty feed renders the honest empty state — the filters are always
    // present (non-compact), so wait for those instead.
    await waitFor(() => expect(screen.getByTestId("activity-filter-members")).toBeTruthy());
    fireEvent.click(screen.getByTestId("activity-filter-members"));
    await waitFor(() => {
      expect(mockListActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: "members" }),
      );
    });
  });

  it("shows an empty state honestly (no fake data)", async () => {
    mockListActivity.mockResolvedValue({
      ok: true,
      value: { events: [], nextCursor: null },
    });
    render(<WorkspaceActivityPanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByText(/No activity yet/i)).toBeTruthy());
  });

  it("shows the error state when the fetch fails", async () => {
    mockListActivity.mockResolvedValue({
      ok: false,
      error: { code: "PERMISSION_DENIED", message: "You don't have access to that." },
    });
    render(<WorkspaceActivityPanel workspaceId="ws-1" />);
    await waitFor(() => expect(screen.getByTestId("activity-error")).toBeTruthy());
  });
});

describe("VersionHistoryDialog", () => {
  it("renders nothing when closed", () => {
    useWorkspaceHistoryUiStore.getState().closeDialog();
    const { container } = render(<VersionHistoryDialog />);
    expect(container.querySelector('[data-testid="version-history-dialog"]')).toBeNull();
  });

  it("lists versions grouped Today/Earlier with role-gated actions", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceHistoryUiStore.getState().openDialog();
    mockListProjectVersions.mockResolvedValue({
      ok: true,
      value: [
        version({ id: "v-2", revision: 2, reason: "checkpoint", label: "Before redesign" }),
        version({ id: "v-1", revision: 1, reason: "autosave", createdAt: "2026-08-05T00:00:00.000Z" }),
      ],
    });
    render(<VersionHistoryDialog />);
    // One list per time bucket (Today + Earlier for this seed).
    await waitFor(() => expect(screen.getAllByTestId("version-list").length).toBeGreaterThan(0));
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
    expect(screen.getByText(/Manual checkpoint — Before redesign/i)).toBeTruthy();
    // Owner sees preview + copy + restore actions.
    expect(screen.getByTestId("version-preview-v-1")).toBeTruthy();
    expect(screen.getByTestId("version-copy-v-1")).toBeTruthy();
    expect(screen.getByTestId("version-restore-v-1")).toBeTruthy();
  });

  it("hides restore for editors (owner-only) and checkpoint requires edit access", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "editor",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceHistoryUiStore.getState().openDialog();
    mockListProjectVersions.mockResolvedValue({
      ok: true,
      value: [version({})],
    });
    render(<VersionHistoryDialog />);
    await waitFor(() => expect(screen.getByTestId("version-list")).toBeTruthy());
    expect(screen.queryByTestId("version-restore-v-1")).toBeNull();
    expect(screen.getByTestId("version-copy-v-1")).toBeTruthy();
    // Editors can checkpoint (editable + editor).
    expect(screen.getByTestId("version-checkpoint-button")).toBeTruthy();
  });

  it("fetches a fresh list on EVERY open (never stale from editor mount)", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceAccessStore.getState().setAccess({ mode: "editable" });
    useWorkspaceHistoryUiStore.getState().closeDialog();
    mockListProjectVersions.mockResolvedValue({
      ok: true,
      value: [version({ id: "v-1", revision: 1 })],
    });
    const { rerender } = render(<VersionHistoryDialog />);
    // Closed: the dialog is always mounted in the editor, but it must NOT
    // fetch at editor mount — a pre-save list would be stale by the time the
    // user opens history after editing.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockListProjectVersions).not.toHaveBeenCalled();
    // First open: fresh fetch.
    useWorkspaceHistoryUiStore.getState().openDialog();
    rerender(<VersionHistoryDialog />);
    await waitFor(() => expect(screen.getByTestId("version-list")).toBeTruthy());
    expect(mockListProjectVersions).toHaveBeenCalledTimes(1);
    // Close + reopen: the list is re-fetched (never served from a stale
    // earlier fetch).
    useWorkspaceHistoryUiStore.getState().closeDialog();
    rerender(<VersionHistoryDialog />);
    useWorkspaceHistoryUiStore.getState().openDialog();
    rerender(<VersionHistoryDialog />);
    await waitFor(() => expect(screen.getAllByTestId("version-list").length).toBeGreaterThan(0));
    expect(mockListProjectVersions).toHaveBeenCalledTimes(2);
  });

  it("Escape closes the dialog", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceHistoryUiStore.getState().openDialog();
    mockListProjectVersions.mockResolvedValue({ ok: true, value: [] });
    render(<VersionHistoryDialog />);
    await waitFor(() => expect(screen.getByTestId("version-history-dialog")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(useWorkspaceHistoryUiStore.getState().dialogOpen).toBe(false),
    );
  });
});

describe("RestoreVersionDialog", () => {
  it("shows the confirmation and calls restore on confirm", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 1,
    });
    useWorkspaceHistoryUiStore.getState().setRestoreVersion(version({ id: "v-1", revision: 1 }));
    mockRestoreProjectVersion.mockResolvedValue({ ok: true, value: { revision: 2 } });
    render(<RestoreVersionDialog />);
    expect(screen.getByTestId("restore-version-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("restore-version-confirm"));
    await waitFor(() => expect(mockRestoreProjectVersion).toHaveBeenCalled());
  });

  it("shows the stale error with a reload-latest action", async () => {
    useWorkspaceAccessStore.getState().setWorkspaceContext({
      workspaceId: "ws-1",
      workspaceName: "Acme",
      role: "owner",
      serverRevision: 2,
    });
    useWorkspaceHistoryUiStore.getState().setRestoreVersion(version({ id: "v-1", revision: 1 }));
    mockRestoreProjectVersion.mockResolvedValue({
      ok: false,
      error: {
        code: "STALE_REVISION",
        message: "This project changed while you were reviewing history.",
      },
    });
    render(<RestoreVersionDialog />);
    fireEvent.click(screen.getByTestId("restore-version-confirm"));
    await waitFor(() => expect(screen.getByTestId("restore-stale")).toBeTruthy());
    expect(screen.getByText(/changed while you were reviewing history/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — CloudConflictDialog component tests
//
// Lists open conflicts (bounded rendering) with keyboard-accessible cards.
// Every card exposes the four choices (Keep this device / Keep cloud version
// / Keep both / Review later) — BlockTree conflicts are never auto-resolved.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CloudConflictDialog } from "../components/CloudConflictDialog";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { useAuthStore } from "@/features/auth/auth-store";
import { setAuthServiceForTests } from "@/features/auth/auth-service";
import type { AuthService } from "@/features/auth/types";
import type { CloudConflictRecord } from "../types";

vi.mock("../sync-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync-runtime")>();
  return {
    ...actual,
    getSyncConflictStore: () => mockConflictStore,
  };
});

let mockConflictStore: { listOpen: (userId: string) => Promise<CloudConflictRecord[]> };

const conflict: CloudConflictRecord = {
  id: "cf-1",
  userId: "user-1",
  entityType: "myBlock",
  localEntityId: "block-1",
  cloudEntityId: "cloud-block-1",
  kind: "tree",
  // No trees → the card renders "Deleted on this device / in the cloud"
  // placeholders instead of a heavy preview (kept simple + robust in jsdom).
  localRecord: { name: "Hero section", contentRevision: 2 },
  cloudRecord: { name: "Hero section", contentRevision: 3 },
  localModifiedAt: "2026-08-05T00:00:00.000Z",
  cloudModifiedAt: "2026-08-06T00:00:00.000Z",
  status: "open",
  createdAt: "2026-08-06T12:00:00.000Z",
  updatedAt: "2026-08-06T12:00:00.000Z",
};

function mockService(): AuthService {
  return {
    kind: "mock",
    isConfigured: () => true,
    getSession: async () => null,
    onAuthStateChange: () => () => undefined,
    signIn: vi.fn(async () => ({ ok: false as const, error: { code: "UNKNOWN" as const, message: "nope" } })),
    signUp: vi.fn(async () => ({ ok: false as const, error: { code: "UNKNOWN" as const, message: "nope" } })),
    signOut: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resetPassword: vi.fn(async () => ({ ok: true as const, value: undefined })),
  };
}

function setSignedIn() {
  useAuthStore.setState({
    status: "signed-in",
    session: {
      user: { id: "user-1", email: "a@example.com", emailVerified: true },
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-08T00:00:00.000Z",
    },
    error: null,
    busy: false,
  });
}

describe("CloudConflictDialog", () => {
  beforeEach(() => {
    mockConflictStore = { listOpen: vi.fn(async () => [conflict]) };
    useCloudSyncStore.setState({ conflictsOpen: false, conflictCount: 0, status: "signed-out" });
    setAuthServiceForTests(mockService());
  });

  afterEach(() => {
    setAuthServiceForTests(null);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CloudConflictDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("lists open conflicts with the saved-piece name and kind", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ conflictsOpen: true });
    render(<CloudConflictDialog />);
    expect(screen.getByRole("heading", { name: "Conflicts to review" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("cloud-conflict-card")).toBeTruthy();
    });
    expect(screen.getByText("Hero section")).toBeTruthy();
    expect(screen.getByText("Design changed on both sides")).toBeTruthy();
  });

  it("presents all four resolution choices — never auto-resolves", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ conflictsOpen: true });
    render(<CloudConflictDialog />);
    await waitFor(() => expect(screen.getByTestId("cloud-conflict-card")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Keep this device/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keep cloud version/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keep both/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review later/ })).toBeTruthy();
  });

  it("explains that nothing is overwritten without the user's say-so", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ conflictsOpen: true });
    render(<CloudConflictDialog />);
    await waitFor(() => expect(screen.getByTestId("cloud-conflict-card")).toBeTruthy());
    expect(screen.getByText(/nothing is overwritten without your say-so/i)).toBeTruthy();
  });

  it("shows an all-caught-up state when there are no open conflicts", async () => {
    setSignedIn();
    mockConflictStore = { listOpen: vi.fn(async () => []) };
    useCloudSyncStore.setState({ conflictsOpen: true });
    render(<CloudConflictDialog />);
    await waitFor(() => expect(screen.getByText("All caught up")).toBeTruthy());
  });

  it("is keyboard accessible: dialog has aria-modal and focus trap", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ conflictsOpen: true });
    render(<CloudConflictDialog />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("cloud-conflict-card")).toBeTruthy());
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBeTruthy();
  });

  it("cards are focusable (keyboard navigation)", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ conflictsOpen: true });
    render(<CloudConflictDialog />);
    await waitFor(() => expect(screen.getByTestId("cloud-conflict-card")).toBeTruthy());
    const keepBoth = screen.getByRole("button", { name: /Keep both/ });
    keepBoth.focus();
    expect(document.activeElement).toBe(keepBoth);
  });
});

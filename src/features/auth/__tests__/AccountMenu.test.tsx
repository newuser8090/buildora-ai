// ---------------------------------------------------------------------------
// Auth (Phase P6) — AccountMenu component tests
//
// Avatar menu for both states: signed-out users get the beginner copy + sign
// in CTA; signed-in users see their email, sync summary, and sign-out.
// Signing out NEVER deletes local data — the menu says so explicitly.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountMenu } from "../components/AccountMenu";
import { useAuthStore } from "../auth-store";
import { setAuthServiceForTests } from "../auth-service";
import { useCloudSyncStore } from "@/features/cloud-sync/store/cloud-sync-store";
import type { AuthService } from "../types";

function mockService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    kind: "mock",
    isConfigured: () => true,
    getSession: async () => null,
    onAuthStateChange: () => () => undefined,
    signIn: vi.fn(async () => ({ ok: true as const, value: { user: { id: "u", email: "a@example.com", emailVerified: true }, createdAt: "", expiresAt: "" } })),
    signUp: vi.fn(async () => ({ ok: false as const, error: { code: "UNKNOWN" as const, message: "nope" } })),
    signOut: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resetPassword: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function setSignedIn(email = "a@example.com") {
  useAuthStore.setState({
    status: "signed-in",
    session: {
      user: { id: "user-1", email, emailVerified: true },
      createdAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-08T00:00:00.000Z",
    },
    error: null,
    busy: false,
  });
}

function setSignedOut() {
  useAuthStore.setState({ status: "signed-out", session: null, error: null, busy: false });
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
}

describe("AccountMenu", () => {
  beforeEach(() => {
    useCloudSyncStore.setState({ status: "signed-out", conflictCount: 0, pendingUploadCount: 0 });
    setAuthServiceForTests(mockService());
  });

  afterEach(() => {
    setAuthServiceForTests(null);
  });

  it("shows the local-only copy for signed-out users", () => {
    setSignedOut();
    render(<AccountMenu />);
    openMenu();
    expect(screen.getByText("Your saved pieces live on this device.")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign in to back up" })).toBeTruthy();
  });

  it("opens the sign-in dialog from the signed-out menu", () => {
    setSignedOut();
    render(<AccountMenu />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign in to back up" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the account email and backed-up copy when signed in", () => {
    setSignedIn("hello@example.com");
    render(<AccountMenu />);
    openMenu();
    expect(screen.getByText("hello@example.com")).toBeTruthy();
    expect(screen.getByText("Your saved pieces are backed up.")).toBeTruthy();
  });

  it("signs out and retains local data (copy states it explicitly)", async () => {
    const service = mockService();
    setAuthServiceForTests(service);
    setSignedIn();
    render(<AccountMenu />);
    openMenu();
    expect(screen.getByText("Signing out keeps your saved pieces on this device.")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(service.signOut).toHaveBeenCalled());
    await waitFor(() =>
      expect(useAuthStore.getState().status).toBe("signed-out"),
    );
    // Local My Blocks are intentionally retained — only session state cleared.
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("shows a conflict badge and the review count", () => {
    setSignedIn();
    useCloudSyncStore.setState({ status: "conflict", conflictCount: 2 });
    render(<AccountMenu />);
    expect(screen.getByLabelText("2 conflicts to review")).toBeTruthy();
    openMenu();
    expect(screen.getByText("2 conflicts to review")).toBeTruthy();
  });

  it("offers shared libraries and account settings entries when signed in", () => {
    setSignedIn();
    render(<AccountMenu />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: /Shared libraries/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Account & backup/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sync now" })).toBeTruthy();
  });
});

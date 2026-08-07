// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — CloudSyncStatusControl component tests
//
// Compact status control: "Saved locally", "Syncing…", "Synced", "Offline —
// changes saved here", "Sync needs attention", "Conflicts to review". Never
// shows a misleading "Synced"; announces changes via a polite live region;
// offline is never color-only (icon + text).
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloudSyncStatusControl } from "../components/CloudSyncStatusControl";
import { useCloudSyncStore, type CloudSyncUiState } from "../store/cloud-sync-store";
import { useAuthStore } from "@/features/auth/auth-store";
import { setAuthServiceForTests } from "@/features/auth/auth-service";
import type { AuthService } from "@/features/auth/types";

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

function setAuth(status: "signed-in" | "signed-out") {
  useAuthStore.setState({
    status,
    session:
      status === "signed-in"
        ? {
            user: { id: "user-1", email: "a@example.com", emailVerified: true },
            createdAt: "2026-08-01T00:00:00.000Z",
            expiresAt: "2026-08-08T00:00:00.000Z",
          }
        : null,
    error: null,
    busy: false,
  });
}

function resetSync(patch: Partial<CloudSyncUiState>) {
  useCloudSyncStore.setState({
    status: "signed-out",
    conflictCount: 0,
    online: true,
    ...patch,
  });
}

describe("CloudSyncStatusControl", () => {
  beforeEach(() => {
    setAuthServiceForTests(mockService());
    resetSync({});
  });

  afterEach(() => {
    setAuthServiceForTests(null);
  });

  it("signed-out users see 'Saved locally'", () => {
    setAuth("signed-out");
    render(<CloudSyncStatusControl />);
    expect(screen.getByRole("button", { name: /Saved locally/ })).toBeTruthy();
  });

  it("announces state through a polite live region", () => {
    setAuth("signed-out");
    render(<CloudSyncStatusControl />);
    const live = document.querySelector('[role="status"][aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toContain("Saved locally");
  });

  it("signed-in + synced shows 'Synced'", () => {
    setAuth("signed-in");
    resetSync({ status: "synced" });
    render(<CloudSyncStatusControl />);
    expect(screen.getByRole("button", { name: /Synced/ })).toBeTruthy();
  });

  it("signed-in + offline shows 'Offline — changes saved here' (not color-only)", () => {
    setAuth("signed-in");
    resetSync({ status: "offline" });
    render(<CloudSyncStatusControl />);
    expect(screen.getByRole("button", { name: /Offline — changes saved here/ })).toBeTruthy();
  });

  it("signed-in + conflict shows the count to review", () => {
    setAuth("signed-in");
    resetSync({ status: "conflict", conflictCount: 3 });
    render(<CloudSyncStatusControl />);
    expect(screen.getByRole("button", { name: /3 conflicts to review/ })).toBeTruthy();
  });

  it("signed-in + error shows 'Sync needs attention'", () => {
    setAuth("signed-in");
    resetSync({ status: "error" });
    render(<CloudSyncStatusControl />);
    expect(screen.getByRole("button", { name: /Sync needs attention/ })).toBeTruthy();
  });

  it("signed-out menu offers 'Sign in to back up' and 'How backup works'", () => {
    setAuth("signed-out");
    render(<CloudSyncStatusControl />);
    fireEvent.click(screen.getByRole("button", { name: /Saved locally/ }));
    expect(screen.getByRole("menuitem", { name: "Sign in to back up" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "How backup works" })).toBeTruthy();
  });

  it("signed-in menu offers 'Sync now' and hides the sign-in CTA", () => {
    setAuth("signed-in");
    resetSync({ status: "synced" });
    render(<CloudSyncStatusControl />);
    fireEvent.click(screen.getByRole("button", { name: /Synced/ }));
    expect(screen.getByRole("menuitem", { name: "Sync now" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Sign in to back up" })).toBeNull();
  });

  it("conflict menu exposes 'Review conflicts' when conflicts exist", () => {
    setAuth("signed-in");
    resetSync({ status: "conflict", conflictCount: 1 });
    render(<CloudSyncStatusControl />);
    fireEvent.click(screen.getByRole("button", { name: /1 conflict to review/ }));
    expect(screen.getByRole("menuitem", { name: "Review conflicts" })).toBeTruthy();
  });
});

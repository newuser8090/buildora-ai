// ---------------------------------------------------------------------------
// Auth (Phase P6) — CloudSyncPrompt component tests
//
// Beginner-first account UX: signed-out users see "Your saved pieces live on
// this device." + "Back them up and use them anywhere."; signed-in users see
// nothing (the prompt self-hides). No database jargon.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloudSyncPrompt } from "../components/CloudSyncPrompt";
import { useAuthStore } from "../auth-store";
import { setAuthServiceForTests } from "../auth-service";
import type { AuthService } from "../types";

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

function setStatus(status: "signed-out" | "signed-in" | "loading") {
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

describe("CloudSyncPrompt", () => {
  beforeEach(() => {
    setAuthServiceForTests(mockService());
  });

  afterEach(() => {
    setAuthServiceForTests(null);
  });

  it("shows the beginner copy for signed-out users with saved pieces", () => {
    setStatus("signed-out");
    render(<CloudSyncPrompt blockCount={3} />);
    expect(screen.getByText("Your 3 saved pieces live on this device.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Back them up and use them anywhere" }),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "Back up your saved pieces" })).toBeTruthy();
  });

  it("uses singular copy for a single saved piece", () => {
    setStatus("signed-out");
    render(<CloudSyncPrompt blockCount={1} />);
    expect(screen.getByText("Your 1 saved piece lives on this device.")).toBeTruthy();
  });

  it("explains privacy without database jargon", () => {
    setStatus("signed-out");
    render(<CloudSyncPrompt />);
    const text = screen.getByRole("region").textContent ?? "";
    expect(text).toContain("Nothing is published publicly");
    expect(text.toLowerCase()).not.toContain("database");
    expect(text.toLowerCase()).not.toContain("replication");
  });

  it("opens the sign-up dialog from the CTA", () => {
    setStatus("signed-out");
    render(<CloudSyncPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Back them up and use them anywhere" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("self-hides when signed in", () => {
    setStatus("signed-in");
    const { container } = render(<CloudSyncPrompt blockCount={5} />);
    expect(container.firstChild).toBeNull();
  });

  it("self-hides while the session is restoring", () => {
    setStatus("loading");
    const { container } = render(<CloudSyncPrompt />);
    expect(container.firstChild).toBeNull();
  });
});

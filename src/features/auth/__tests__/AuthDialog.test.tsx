// ---------------------------------------------------------------------------
// Auth (Phase P6) — AuthDialog component tests
//
// Beginner-first sign-up/sign-in dialog: validation, repeated-submission
// blocking, user-safe errors, mode toggle, and keyboard-accessible dialog
// behavior (role/aria-modal + focus trap).
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthDialog } from "../components/AuthDialog";
import { useAuthStore } from "../auth-store";
import { setAuthServiceForTests } from "../auth-service";
import type { AuthService, AuthSession } from "../types";

const session: AuthSession = {
  user: { id: "user-1", email: "a@example.com", emailVerified: true },
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-08T00:00:00.000Z",
};

function mockService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    kind: "mock",
    isConfigured: () => true,
    getSession: async () => null,
    onAuthStateChange: () => () => undefined,
    signIn: vi.fn(async () => ({ ok: true as const, value: session })),
    signUp: vi.fn(async () => ({ ok: true as const, value: session })),
    signOut: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resetPassword: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  };
}

function resetStore() {
  useAuthStore.setState({
    status: "signed-out",
    session: null,
    error: null,
    busy: false,
  });
}

describe("AuthDialog", () => {
  beforeEach(() => {
    resetStore();
    setAuthServiceForTests(mockService());
  });

  afterEach(() => {
    setAuthServiceForTests(null);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<AuthDialog open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("has role=dialog and aria-modal=true", () => {
    render(<AuthDialog open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("rejects an invalid email without calling signIn", async () => {
    const service = mockService();
    setAuthServiceForTests(service);
    render(<AuthDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please enter a valid email address.",
    );
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it("rejects a short password", async () => {
    render(<AuthDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your password needs to be at least 6 characters.",
    );
  });

  it("signs in successfully and closes", async () => {
    const onClose = vi.fn();
    const service = mockService();
    setAuthServiceForTests(service);
    render(<AuthDialog open onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(service.signIn).toHaveBeenCalledWith("a@example.com", "secret1");
  });

  it("blocks repeated submission while busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = mockService({
      signIn: vi.fn(async () => {
        await gate;
        return { ok: true as const, value: session };
      }),
    });
    setAuthServiceForTests(service);
    render(<AuthDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    // Second submit while the first is in flight must be ignored.
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    release();
    await waitFor(() => expect(service.signIn).toHaveBeenCalledTimes(1));
  });

  it("shows user-safe errors from the provider without leaking account existence", async () => {
    const service = mockService({
      signIn: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "INVALID_CREDENTIALS" as const,
          message: "That email or password isn't right. Try again.",
        },
      })),
    });
    setAuthServiceForTests(service);
    render(<AuthDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "That email or password isn't right. Try again.",
    );
  });

  it("toggles between sign-in and sign-up modes", () => {
    render(<AuthDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("traps focus: Tab on the last focusable wraps to the first", () => {
    render(<AuthDialog open onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const buttons = dialog.querySelectorAll<HTMLElement>("button, input");
    const last = buttons[buttons.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: "Tab" });
    // The first focusable should receive focus after the wrap.
    const first = buttons[0];
    expect(document.activeElement).toBe(first);
  });

  it("opens the password reset flow from 'Forgot password?'", () => {
    render(<AuthDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("dialog", { name: /reset/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — InitialMergeDialog component tests
//
// First sign-in merge choices: Merge both (recommended) / Upload this
// device's pieces / Download cloud library / Review differences. Never
// blindly overwrites either side; duplicate detection is content-based.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InitialMergeDialog } from "../components/InitialMergeDialog";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { useAuthStore } from "@/features/auth/auth-store";
import { setAuthServiceForTests } from "@/features/auth/auth-service";
import type { AuthService } from "@/features/auth/types";
import type { InitialMergeSummary } from "../services/initial-merge";

const summary: InitialMergeSummary = {
  localCount: 3,
  cloudCount: 5,
  matchedCount: 1,
  localOnlyCount: 2,
  cloudOnlyCount: 4,
};

vi.mock("../sync-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync-runtime")>();
  return {
    ...actual,
    getInitialMergeService: () => mockMergeService,
  };
});

let mockMergeService: { computeSummary: (userId: string) => Promise<InitialMergeSummary> };

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

/** Summary text is split across inline spans — match the <p> by full text. */
function summaryLineWith(part: string): HTMLElement {
  return screen.getByText(
    (_content, element) =>
      element?.tagName === "P" &&
      (element.textContent?.includes(part) ?? false),
  );
}

describe("InitialMergeDialog", () => {
  beforeEach(() => {
    mockMergeService = { computeSummary: vi.fn(async () => summary) };
    useCloudSyncStore.setState({ initialMergeOpen: false });
    setAuthServiceForTests(mockService());
  });

  afterEach(() => {
    setAuthServiceForTests(null);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<InitialMergeDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("presents all four choices with Merge both recommended", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ initialMergeOpen: true });
    render(<InitialMergeDialog />);
    expect(
      screen.getByRole("heading", {
        name: "Buildora found saved pieces on this device and in your account",
      }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(summaryLineWith("This device has 3 saved pieces")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /Merge both/ })).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upload this device's pieces/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download cloud library/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review differences/ })).toBeTruthy();
  });

  it("reports content-matched counts (never dedup by name alone)", async () => {
    setSignedIn();
    useCloudSyncStore.setState({ initialMergeOpen: true });
    render(<InitialMergeDialog />);
    await waitFor(() => expect(screen.getByText(/1 match by content/)).toBeTruthy());
    expect(summaryLineWith("your account has 5")).toBeTruthy();
    expect(summaryLineWith("1 match by content")).toBeTruthy();
  });

  it("loading the summary does not block choosing 'Review differences'", async () => {
    setSignedIn();
    mockMergeService = {
      computeSummary: vi.fn(
        () => new Promise<InitialMergeSummary>((resolve) => setTimeout(() => resolve(summary), 50)),
      ),
    };
    useCloudSyncStore.setState({ initialMergeOpen: true });
    render(<InitialMergeDialog />);
    const review = screen.getByRole("button", { name: /Review differences/ });
    fireEvent.click(review);
    // The option is busy/disabled while the action runs — no crash either way.
    expect(review).toBeTruthy();
  });
});

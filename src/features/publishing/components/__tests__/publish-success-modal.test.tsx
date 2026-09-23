// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// PublishSuccessModal (Stage 5) — component tests
//
// Covers: closed render, live preview URL generation (origin + /preview/<id>),
// copy-link "Copied!" feedback, QR code SVG rendering for the URL, and the
// "Open Live Site" CTA pointing at the same URL in a new tab.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublishSuccessModal, buildLivePreviewUrl } from "../PublishSuccessModal";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { buildQrMatrix } from "../../utils/qr-code";
import type { Project } from "@/types/project";

function makeProject(): Project {
  return {
    id: "proj-live",
    name: "Live Site",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "a", md: "b", lg: "c", xl: "d" },
    },
    assets: [],
    pages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildLivePreviewUrl", () => {
  it("joins the current origin with the preview route", () => {
    expect(buildLivePreviewUrl("proj-live")).toBe(`${window.location.origin}/preview/proj-live`);
  });
});

describe("buildQrMatrix", () => {
  it("encodes a URL into a valid square matrix", () => {
    const matrix = buildQrMatrix(`${window.location.origin}/preview/proj-live`);
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    expect(matrix.modules).toHaveLength(matrix.size);
    for (const row of matrix.modules) expect(row).toHaveLength(matrix.size);
    // Finder patterns present at the three corners (top-left 7x7 ring dark).
    expect(matrix.modules[0][0]).toBe(true);
    expect(matrix.modules[0][6]).toBe(true);
    expect(matrix.modules[6][0]).toBe(true);
  });

  it("rejects payloads beyond the version-6 capacity", () => {
    expect(() => buildQrMatrix("x".repeat(200))).toThrow(/too long/i);
  });
});

describe("PublishSuccessModal", () => {
  beforeEach(() => {
    useEditorStore.setState({ project: makeProject() });
  });

  it("renders nothing when closed", () => {
    render(<PublishSuccessModal open={false} onClose={() => undefined} />);
    expect(screen.queryByTestId("publish-modal")).toBeNull();
  });

  it("shows the celebration, live URL, and open-site CTA", () => {
    render(<PublishSuccessModal open onClose={() => undefined} />);
    expect(screen.getByText("Your website is live!")).toBeTruthy();
    expect(screen.getByTestId("publish-live-url").textContent).toBe(
      `${window.location.origin}/preview/proj-live`,
    );
    const open = screen.getByTestId("publish-open-live") as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe(`${window.location.origin}/preview/proj-live`);
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("renders a QR code encoding the live URL", () => {
    render(<PublishSuccessModal open onClose={() => undefined} />);
    const qr = screen.getByTestId("publish-qr");
    expect(qr.getAttribute("viewBox")).toMatch(/0 0 \d+ \d+/);
  });

  it("shows instant Copied! feedback on copy link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PublishSuccessModal open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId("publish-copy-link"));
    await waitFor(() => {
      expect(screen.getByTestId("publish-copy-link").textContent).toContain("Copied!");
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/preview/proj-live`);
  });

  it("Escape closes the modal", () => {
    const onClose = vi.fn();
    render(<PublishSuccessModal open onClose={onClose} />);
    fireEvent(window, new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalled();
  });
});

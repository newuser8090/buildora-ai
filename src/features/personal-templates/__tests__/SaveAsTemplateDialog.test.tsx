// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — SaveAsTemplateDialog tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SaveAsTemplateDialog } from "../components/SaveAsTemplateDialog";
import type { Project } from "@/types/project";

function makeProject(): Project {
  return {
    id: "proj-x",
    name: "My Website",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s1",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Hi", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("SaveAsTemplateDialog", () => {
  beforeEach(() => cleanup());

  it("prefills the name from the project and saves with trimmed fields", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    render(
      <SaveAsTemplateDialog
        open
        project={makeProject()}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    const nameInput = screen.getByLabelText(/Template name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("My Website");
    fireEvent.change(nameInput, { target: { value: "  Portfolio Base  " } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: "A clean start" } });
    fireEvent.change(screen.getByLabelText(/Tags/i), { target: { value: "portfolio, starter" } });

    fireEvent.click(screen.getByTestId("sat-save-button"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave).toHaveBeenCalledWith({
      name: "Portfolio Base",
      description: "A clean start",
      category: "business",
      tags: ["portfolio", "starter"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("disables saving for an empty name without calling onSave", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(
      <SaveAsTemplateDialog
        open
        project={makeProject()}
        onClose={() => {}}
        onSave={onSave}
      />,
    );

    const nameInput = screen.getByLabelText(/Template name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "   " } });

    const saveButton = screen.getByTestId("sat-save-button") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(saveButton);
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());
  });

  it("surfaces a save error and keeps the dialog open", async () => {
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "PERSONAL_TEMPLATE_QUOTA_EXCEEDED", message: "You've saved a lot of templates." },
    });
    const onClose = vi.fn();
    render(
      <SaveAsTemplateDialog
        open
        project={makeProject()}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByTestId("sat-save-button"));
    await waitFor(() =>
      expect(screen.getByTestId("sat-save-error").textContent).toContain("saved a lot of templates"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

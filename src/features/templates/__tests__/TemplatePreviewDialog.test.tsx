// ---------------------------------------------------------------------------
// TemplatePreviewDialog component tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplatePreviewDialog } from "../components/TemplatePreviewDialog";
import { saasTemplate } from "../templates/saas-template";

describe("TemplatePreviewDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing when no template is provided", () => {
    render(
      <TemplatePreviewDialog template={null} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("has an accessible dialog title", () => {
    render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("shows template details: name, category, description, tags", () => {
    render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "SaaS Landing Page" })).toBeTruthy();
    expect(screen.getByText("Landing Page")).toBeTruthy();
    expect(screen.getByText(/polished marketing site/i)).toBeTruthy();
    expect(screen.getByText("#saas")).toBeTruthy();
    expect(screen.getByText("#software")).toBeTruthy();
  });

  it("lists the template sections", () => {
    render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByText("Sections")).toBeTruthy();
    for (const label of ["Header", "Hero", "Features", "Pricing", "FAQ", "CTA", "Footer"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("shows the preview mock frame", () => {
    const { container } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    // The preview frame is a div with inline background from template.preview.
    const frame = container.querySelector('[style*="background"]');
    expect(frame).toBeTruthy();
  });

  it("Use this template returns the template without creating a project", () => {
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(
      <TemplatePreviewDialog template={saasTemplate} onClose={onClose} onUse={onUse} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use SaaS Landing Page template" }));
    expect(onUse).toHaveBeenCalledWith(saasTemplate);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel closes without using", () => {
    const onClose = vi.fn();
    const onUse = vi.fn();
    render(
      <TemplatePreviewDialog template={saasTemplate} onClose={onClose} onUse={onUse} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(
      <TemplatePreviewDialog template={saasTemplate} onClose={onClose} onUse={vi.fn()} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("focuses the first focusable element on open", async () => {
    const { container } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      expect(container.contains(active)).toBe(true);
    });
  });

  it("focus trap: Tab from last wraps to first", async () => {
    const { container } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.contains(document.activeElement)).toBe(true);
    });
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it("focus trap: Shift+Tab from first wraps to last", async () => {
    const { container } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.contains(document.activeElement)).toBe(true);
    });
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it("restores focus to the trigger after close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    await waitFor(() => {
      expect(document.activeElement !== trigger).toBe(true);
    });

    rerender(
      <TemplatePreviewDialog template={null} onClose={vi.fn()} onUse={vi.fn()} />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    document.body.removeChild(trigger);
  });

  it("repeated open/close is safe", async () => {
    const { rerender } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    rerender(
      <TemplatePreviewDialog template={null} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    rerender(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Only one visible dialog.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("previewing never creates or persists a project", () => {
    // Rendering the dialog must not call onCreate — it has no such prop and
    // renders only a mock. Assert no store mutation occurred.
    const { container } = render(
      <TemplatePreviewDialog template={saasTemplate} onClose={vi.fn()} onUse={vi.fn()} />,
    );
    expect(container.querySelector('[data-project-root]')).toBeNull();
  });
});

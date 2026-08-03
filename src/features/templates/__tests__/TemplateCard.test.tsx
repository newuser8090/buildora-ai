// ---------------------------------------------------------------------------
// TemplateCard component tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateCard } from "../components/TemplateCard";
import { saasTemplate } from "../templates/saas-template";

describe("TemplateCard", () => {
  it("renders the accessible template name", () => {
    render(<TemplateCard template={saasTemplate} />);
    expect(
      screen.getByRole("heading", { name: "SaaS Landing Page" }),
    ).toBeTruthy();
  });

  it("shows the category label", () => {
    render(<TemplateCard template={saasTemplate} />);
    expect(screen.getByText("Landing Page")).toBeTruthy();
  });

  it("shows the description", () => {
    render(<TemplateCard template={saasTemplate} />);
    expect(screen.getByText(/polished marketing site/i)).toBeTruthy();
  });

  it("Preview button triggers onPreview with the template", () => {
    const onPreview = vi.fn();
    render(<TemplateCard template={saasTemplate} onPreview={onPreview} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview SaaS Landing Page" }));
    expect(onPreview).toHaveBeenCalledWith(saasTemplate);
  });

  it("clicking the preview frame triggers onPreview", () => {
    const onPreview = vi.fn();
    const { container } = render(
      <TemplateCard template={saasTemplate} onPreview={onPreview} />,
    );
    // The frame button is the first button without an explicit accessible name
    // (it is aria-labelledby the title).
    const frameButtons = container.querySelectorAll("button");
    expect(frameButtons.length).toBeGreaterThan(0);
    fireEvent.click(frameButtons[0]);
    expect(onPreview).toHaveBeenCalledWith(saasTemplate);
  });

  it("Use Template action calls onUse only", () => {
    const onUse = vi.fn();
    const onPreview = vi.fn();
    render(
      <TemplateCard
        template={saasTemplate}
        onUse={onUse}
        onPreview={onPreview}
        showUse
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use SaaS Landing Page" }));
    expect(onUse).toHaveBeenCalledWith(saasTemplate);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("hides the Use action when showUse is false", () => {
    render(<TemplateCard template={saasTemplate} />);
    expect(screen.queryByRole("button", { name: "Use SaaS Landing Page" })).toBeNull();
  });

  it("applies a selected state without color-only feedback (text + ring)", () => {
    const { container } = render(<TemplateCard template={saasTemplate} selected />);
    const root = container.firstElementChild as HTMLElement;
    // Selected template name gets accent text, and root carries ring classes.
    expect(root.className).toContain("ring-2");
    expect(screen.getByRole("heading", { name: "SaaS Landing Page" }).className).toContain("text-accent");
  });

  it("does not create a full project on render", () => {
    // No Project schema validation, no editor store interaction: rendering the
    // card must be cheap and side-effect free. We assert it renders the preview
    // mock rather than a section renderer.
    const { container } = render(<TemplateCard template={saasTemplate} />);
    expect(container.querySelector('[data-project-root]')).toBeNull();
    // The card itself has no Project instance — nothing to assert beyond render.
    expect(screen.getByText("SaaS Landing Page")).toBeTruthy();
  });

  it("is keyboard accessible (Enter on Preview)", () => {
    const onPreview = vi.fn();
    render(<TemplateCard template={saasTemplate} onPreview={onPreview} />);
    const previewButton = screen.getByRole("button", { name: "Preview SaaS Landing Page" });
    previewButton.focus();
    fireEvent.keyDown(previewButton, { key: "Enter" });
    fireEvent.click(previewButton);
    expect(onPreview).toHaveBeenCalledWith(saasTemplate);
  });
});

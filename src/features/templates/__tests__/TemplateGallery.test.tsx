// ---------------------------------------------------------------------------
// TemplateGallery component tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TemplateGallery } from "../components/TemplateGallery";
import { templateRegistry } from "../registry/template-registry";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";
import type { BuildoraTemplate } from "../types";

function renderGallery(props: Record<string, unknown> = {}) {
  return render(
    <TemplateGallery
      selectedTemplateId={null}
      onPreview={vi.fn()}
      onUse={vi.fn()}
      {...props}
    />,
  );
}

describe("TemplateGallery", () => {
  beforeEach(() => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
  });

  it("renders the gallery title", () => {
    renderGallery();
    expect(screen.getByText("Start a new project")).toBeTruthy();
  });

  it("shows the blank template option", () => {
    renderGallery();
    // Blank appears in the Featured strip and the All templates grid.
    expect(screen.getAllByText("Blank Project").length).toBeGreaterThan(0);
  });

  it("shows a search input with a label", () => {
    renderGallery();
    expect(screen.getByRole("textbox", { name: "Search templates" })).toBeTruthy();
  });

  it("category controls are labeled", () => {
    renderGallery();
    const group = screen.getByRole("group", { name: "Filter templates by category" });
    expect(group).toBeTruthy();
  });

  it("filters by search query", () => {
    renderGallery();
    const input = screen.getByRole("textbox", { name: "Search templates" });
    fireEvent.change(input, { target: { value: "restaurant" } });
    expect(screen.getByText("Restaurant")).toBeTruthy();
    expect(screen.queryByText("Ecommerce Store")).toBeNull();
  });

  it("filters by category tab", () => {
    renderGallery();
    fireEvent.click(screen.getByRole("button", { name: "Food" }));
    expect(screen.getByText("Restaurant")).toBeTruthy();
    expect(screen.queryByText("Ecommerce Store")).toBeNull();
  });

  it("clearing the search restores all templates", () => {
    renderGallery();
    const input = screen.getByRole("textbox", { name: "Search templates" });
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No templates found")).toBeTruthy();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("No templates found")).toBeNull();
    expect(screen.getByText("Ecommerce Store")).toBeTruthy();
  });

  it("shows a no-results state", () => {
    renderGallery();
    const input = screen.getByRole("textbox", { name: "Search templates" });
    fireEvent.change(input, { target: { value: "definitely-not-a-template" } });
    expect(screen.getByText("No templates found")).toBeTruthy();
  });

  it("only shows categories that exist in the registry", () => {
    renderGallery();
    // All default categories are present in the default set. Scope the query to
    // the category control group to avoid card titles that share a label.
    const group = screen.getByRole("group", { name: "Filter templates by category" });
    for (const label of ["All", "Blank", "Business", "Portfolio", "Commerce", "Food", "Landing Page"]) {
      expect(within(group).getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("template cards are keyboard accessible", () => {
    renderGallery();
    const previewButtons = screen.getAllByRole("button", { name: /^Preview / });
    expect(previewButtons.length).toBeGreaterThan(0);
    // Buttons are focusable natively.
    previewButtons[0].focus();
    expect(document.activeElement).toBe(previewButtons[0]);
  });

  it("selecting a template via Use fires onUse", () => {
    const onUse = vi.fn();
    renderGallery({ onUse });
    fireEvent.click(screen.getAllByRole("button", { name: /^Use / })[0]);
    expect(onUse).toHaveBeenCalled();
  });

  it("preview action fires onPreview and not onUse", () => {
    const onPreview = vi.fn();
    const onUse = vi.fn();
    renderGallery({ onPreview, onUse });
    fireEvent.click(screen.getAllByRole("button", { name: /^Preview / })[0]);
    expect(onPreview).toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("featured section appears when idle on All", () => {
    renderGallery();
    // "Featured" appears as the section heading and as card badges.
    expect(screen.getAllByText("Featured").length).toBeGreaterThan(0);
  });

  it("featured section is hidden while searching", () => {
    renderGallery();
    const input = screen.getByRole("textbox", { name: "Search templates" });
    fireEvent.change(input, { target: { value: "restaurant" } });
    expect(screen.queryByText("Featured")).toBeNull();
  });

  it("does not mutate the registry output", () => {
    const before = JSON.stringify(templateRegistry.list());
    renderGallery();
    const input = screen.getByRole("textbox", { name: "Search templates" });
    fireEvent.change(input, { target: { value: "saas" } });
    expect(JSON.stringify(templateRegistry.list())).toBe(before);
  });

  it("supports 50 mock templates without breaking", () => {
    // Register 43 extra mock templates and verify the grid renders them.
    for (let i = 0; i < 43; i++) {
      const mock: BuildoraTemplate = {
        id: `template-mock-${i}`,
        name: `Mock Template ${i}`,
        description: `A generated mock template ${i}.`,
        category: i % 2 === 0 ? "business" : "portfolio",
        tags: ["mock"],
        defaultName: `Mock ${i}`,
        preview: {
          accent: "#000000",
          sections: [
            { kind: "header", label: "Header" },
            { kind: "hero", label: "Hero" },
            { kind: "footer", label: "Footer" },
          ],
        },
        createProject: () => ({}) as never,
      };
      templateRegistry.register(mock);
    }
    const { container } = renderGallery();
    // All 43 mock templates render as cards.
    expect(screen.getAllByText(/Mock Template \d+/).length).toBe(43);
    // All 50 templates appear (7 default + 43 mock); featured cards are also
    // duplicated in the Featured strip, so the heading/card count exceeds 50.
    const h3s = container.querySelectorAll("h3");
    expect(h3s.length).toBeGreaterThanOrEqual(50);
  });
});

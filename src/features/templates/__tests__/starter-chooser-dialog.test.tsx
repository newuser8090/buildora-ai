// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// StarterChooserDialog — Stage 2 onboarding chooser flow tests
//
// Covers: header copy, the two starting paths (blank canvas / template
// gallery), curated quick-picks rendering and creation handoff, Escape
// close, and busy-state disabling. Creation is asserted through the handler
// props (the canonical controller flow lives in the caller).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StarterChooserDialog } from "../components/StarterChooserDialog";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";
import { templateRegistry } from "../registry/template-registry";

function renderChooser(overrides?: Partial<Parameters<typeof StarterChooserDialog>[0]>) {
  const onCreateBlank = vi.fn();
  const onBrowseTemplates = vi.fn();
  const onCreateTemplate = vi.fn();
  render(
    <StarterChooserDialog
      open
      onClose={() => {}}
      onCreateBlank={onCreateBlank}
      onBrowseTemplates={onBrowseTemplates}
      onCreateTemplate={onCreateTemplate}
      {...overrides}
    />,
  );
  return { onCreateBlank, onBrowseTemplates, onCreateTemplate };
}

describe("StarterChooserDialog", () => {
  it("renders the chooser question and both starting paths", () => {
    renderChooser();
    expect(
      screen.getByText("What kind of website do you want to build?"),
    ).toBeTruthy();
    expect(screen.getByTestId("starter-path-blank")).toBeTruthy();
    expect(screen.getByTestId("starter-path-gallery")).toBeTruthy();
    expect(screen.getByText("Start from Scratch")).toBeTruthy();
    expect(screen.getByText("Choose a Template")).toBeTruthy();
  });

  it("blank path hands off to onCreateBlank", () => {
    const { onCreateBlank } = renderChooser();
    fireEvent.click(screen.getByTestId("starter-path-blank"));
    expect(onCreateBlank).toHaveBeenCalledTimes(1);
  });

  it("gallery path hands off to onBrowseTemplates", () => {
    const { onBrowseTemplates } = renderChooser();
    fireEvent.click(screen.getByTestId("starter-path-gallery"));
    expect(onBrowseTemplates).toHaveBeenCalledTimes(1);
  });

  it("renders curated quick-picks with the promised trio", () => {
    registerDefaultTemplates();
    renderChooser();
    expect(screen.getByTestId("starter-quickpick-template-grocery")).toBeTruthy();
    expect(screen.getByTestId("starter-quickpick-template-portfolio")).toBeTruthy();
    expect(screen.getByTestId("starter-quickpick-template-bakery")).toBeTruthy();
    expect(screen.getByText("Local Grocery Store")).toBeTruthy();
    expect(screen.getByText("Design Portfolio")).toBeTruthy();
    expect(screen.getByText("Modern Bakery")).toBeTruthy();
  });

  it("quick-pick creates its template via the canonical handler", () => {
    registerDefaultTemplates();
    const { onCreateTemplate } = renderChooser();
    fireEvent.click(screen.getByTestId("starter-quickpick-template-grocery"));
    expect(onCreateTemplate).toHaveBeenCalledWith(
      "template-grocery",
      "Local Grocery Store",
    );
  });

  it("Escape closes the dialog via onClose", () => {
    const onClose = vi.fn();
    renderChooser({ onClose });
    fireEvent(window, new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("isBusy disables every action", () => {
    renderChooser({ isBusy: true });
    const blank = screen.getByTestId("starter-path-blank") as HTMLButtonElement;
    const gallery = screen.getByTestId("starter-path-gallery") as HTMLButtonElement;
    expect(blank.disabled).toBe(true);
    expect(gallery.disabled).toBe(true);
  });

  it("renders nothing when closed", () => {
    render(<StarterChooserDialog
      open={false}
      onClose={() => {}}
      onCreateBlank={() => {}}
      onBrowseTemplates={() => {}}
      onCreateTemplate={() => {}}
    />);
    expect(screen.queryByTestId("starter-chooser")).toBeNull();
  });

  it("curated registry lookups resolve after default registration", () => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
    for (const id of ["template-grocery", "template-portfolio", "template-bakery"]) {
      expect(templateRegistry.get(id)).toBeDefined();
    }
  });
});

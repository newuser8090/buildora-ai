// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// GuidedInspector — tests (Phase N, spec §28)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuidedInspector } from "../GuidedInspector";
import type { BaseSection } from "@/types/section";

function heroSection(overrides?: Partial<BaseSection>): BaseSection {
  return {
    id: "s-hero",
    type: "hero",
    order: 1,
    visible: true,
    props: {
      headline: "Build something",
      subheadline: "Supporting line",
      primaryCta: { text: "Get Started", href: "#" },
    },
    styles: {},
    ...overrides,
  };
}

describe("GuidedInspector", () => {
  it("shows friendly labels and current values", () => {
    const section = heroSection();
    render(
      <GuidedInspector
        section={section}
        onUpdateProps={vi.fn()}
        onUpdateStyles={vi.fn()}
      />,
    );
    expect(screen.getByText("Main message")).toBeTruthy();
    expect(screen.getByText("Supporting text")).toBeTruthy();
    expect(screen.getByText("Action button text")).toBeTruthy();
    const headline = screen.getByLabelText("Main message");
    expect((headline as HTMLTextAreaElement).value).toBe("Build something");
  });

  it("updates a top-level field through onUpdateProps", () => {
    const onUpdateProps = vi.fn();
    render(
      <GuidedInspector
        section={heroSection()}
        onUpdateProps={onUpdateProps}
        onUpdateStyles={vi.fn()}
      />,
    );
    const headline = screen.getByLabelText("Main message");
    fireEvent.change(headline, { target: { value: "New message" } });
    expect(onUpdateProps).toHaveBeenCalledWith({ headline: "New message" });
  });

  it("updates nested button text preserving href", () => {
    const onUpdateProps = vi.fn();
    render(
      <GuidedInspector
        section={heroSection()}
        onUpdateProps={onUpdateProps}
        onUpdateStyles={vi.fn()}
      />,
    );
    const cta = screen.getByLabelText("Action button text");
    fireEvent.change(cta, { target: { value: "Buy now" } });
    expect(onUpdateProps).toHaveBeenCalledWith({
      primaryCta: { text: "Buy now", href: "#" },
    });
  });

  it("maps the Spacing preset to styles.padding", () => {
    const onUpdateStyles = vi.fn();
    render(
      <GuidedInspector
        section={heroSection()}
        onUpdateProps={vi.fn()}
        onUpdateStyles={onUpdateStyles}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Spacious" }));
    expect(onUpdateStyles).toHaveBeenCalledWith({ padding: "9rem 0" });
  });

  it("reads the current spacing preset", () => {
    render(
      <GuidedInspector
        section={heroSection({ styles: { padding: "3rem 0" } })}
        onUpdateProps={vi.fn()}
        onUpdateStyles={vi.fn()}
      />,
    );
    const compact = screen.getByRole("button", { name: "Compact" });
    expect(compact.getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back gracefully for unknown section types", () => {
    render(
      <GuidedInspector
        section={heroSection({ type: "unknown-type" })}
        onUpdateProps={vi.fn()}
        onUpdateStyles={vi.fn()}
      />,
    );
    expect(screen.getByTestId("guided-inspector")).toBeTruthy();
  });
});

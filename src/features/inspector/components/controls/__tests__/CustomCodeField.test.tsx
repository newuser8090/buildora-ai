// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P23-D — CustomCodeField component
//   - no payload → Add custom code; enabling requires an explicit confirmation
//   - the confirmation carries the persistent warning; cancel never commits
//   - the warning stays visible (persistent) while custom code is enabled
//   - HTML/CSS/JS plain textareas commit on blur and preserve the enabled flag
//   - per-field counters (20k) and an aggregate counter (48k) are shown
//   - over-aggregate edits are blocked with an error (no commit)
//   - disable keeps the payload inert; remove commits null
//   - the attributes editor is NOT present (deferred in P23-D)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomCodeField, CUSTOM_CODE_WARNING } from "../CustomCodeField";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type { ElementCustomCode } from "@/features/elements/types";
import {
  ELEMENT_MAX_CUSTOM_CODE_LENGTH,
  ELEMENT_MAX_CUSTOM_CODE_TOTAL,
} from "@/features/elements/schemas/element-schemas";

const FIELD: InspectorFieldDef = {
  id: "customCode",
  label: "Custom code",
  kind: "custom-code",
  source: "customCode",
  key: "customCode",
  hint: "Advanced HTML/CSS/JS — runs only in the published site",
};

function renderField(
  value?: ElementCustomCode | null,
  onCommit: (value: ElementCustomCode | null) => boolean = () => true,
) {
  render(<CustomCodeField field={FIELD} value={value} onCommit={onCommit} />);
}

describe("CustomCodeField — enable confirmation (P23-D D3)", () => {
  it("shows Add custom code when no payload exists", () => {
    renderField(undefined);
    expect(screen.getByTestId("custom-code-add")).toBeTruthy();
  });

  it("enabling opens a confirmation with the persistent warning", () => {
    renderField(undefined);
    fireEvent.click(screen.getByTestId("custom-code-add"));
    expect(screen.getByTestId("custom-code-confirm")).toBeTruthy();
    expect(screen.getByText(CUSTOM_CODE_WARNING)).toBeTruthy();
  });

  it("cancel closes the confirmation without committing", () => {
    const onCommit = vi.fn(() => true);
    renderField(undefined, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-add"));
    fireEvent.click(screen.getByTestId("custom-code-confirm-cancel"));
    expect(screen.queryByTestId("custom-code-confirm")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("confirming the enable commits { enabled: true } (one commit)", () => {
    const onCommit = vi.fn(() => true);
    renderField(undefined, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-add"));
    fireEvent.click(screen.getByTestId("custom-code-confirm-enable"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ enabled: true });
  });

  it("enabling with an existing disabled payload preserves the code", () => {
    const onCommit = vi.fn(() => true);
    renderField({ css: "p{}" }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-enable"));
    fireEvent.click(screen.getByTestId("custom-code-confirm-enable"));
    expect(onCommit).toHaveBeenCalledWith({ css: "p{}", enabled: true });
  });

  it("persistent warning is visible while enabled", () => {
    renderField({ enabled: true, css: "p{}" });
    expect(screen.getByTestId("custom-code-warning")).toBeTruthy();
  });
});

describe("CustomCodeField — textareas, counters, limits (P23-D)", () => {
  it("renders HTML/CSS/JS plain textareas for an enabled payload", () => {
    renderField({ enabled: true });
    expect(screen.getByTestId("custom-code-html")).toBeTruthy();
    expect(screen.getByTestId("custom-code-css")).toBeTruthy();
    expect(screen.getByTestId("custom-code-js")).toBeTruthy();
  });

  it("seeds drafts from the stored payload", () => {
    renderField({ enabled: true, html: "<span>hi</span>", css: "p{}", js: "x()" });
    expect((screen.getByTestId("custom-code-html") as HTMLTextAreaElement).value).toBe(
      "<span>hi</span>",
    );
    expect((screen.getByTestId("custom-code-css") as HTMLTextAreaElement).value).toBe("p{}");
    expect((screen.getByTestId("custom-code-js") as HTMLTextAreaElement).value).toBe("x()");
  });

  it("commits a field edit on blur and preserves enabled:true", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, css: "p{}" }, onCommit);
    const css = screen.getByTestId("custom-code-css") as HTMLTextAreaElement;
    fireEvent.change(css, { target: { value: "p { color: red; }" } });
    fireEvent.blur(css);
    expect(onCommit).toHaveBeenCalledWith({ enabled: true, css: "p { color: red; }" });
  });

  it("edits to a disabled (legacy) payload stay inert — enabled stays false", () => {
    const onCommit = vi.fn(() => true);
    renderField({ css: "p{}" }, onCommit);
    const html = screen.getByTestId("custom-code-html") as HTMLTextAreaElement;
    fireEvent.change(html, { target: { value: "<b>bold</b>" } });
    fireEvent.blur(html);
    expect(onCommit).toHaveBeenCalledWith({ css: "p{}", html: "<b>bold</b>" });
  });

  it("shows per-field and aggregate counters", () => {
    const css = "p{}";
    const html = "<span>hi</span>";
    renderField({ enabled: true, css, html });
    expect(screen.getByTestId("custom-code-count-css").textContent).toContain(
      `${css.length} / ${ELEMENT_MAX_CUSTOM_CODE_LENGTH.toLocaleString()}`,
    );
    const total = screen.getByTestId("custom-code-total").textContent;
    expect(total).toContain(
      `${(css.length + html.length).toLocaleString()} / ${ELEMENT_MAX_CUSTOM_CODE_TOTAL.toLocaleString()}`,
    );
  });

  it("blocks an over-aggregate commit and shows the error", () => {
    const onCommit = vi.fn(() => true);
    const cssAtTotal = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_TOTAL);
    renderField({ enabled: true, css: cssAtTotal }, onCommit);
    const html = screen.getByTestId("custom-code-html") as HTMLTextAreaElement;
    fireEvent.change(html, { target: { value: "y" } });
    fireEvent.blur(html);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("custom-code-error")).toBeTruthy();
  });

  it("enforces the per-field cap via maxLength", () => {
    renderField({ enabled: true });
    const js = screen.getByTestId("custom-code-js") as HTMLTextAreaElement;
    expect(js.maxLength).toBe(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
  });
});

describe("CustomCodeField — disable / remove / no attributes (P23-D)", () => {
  it("disable keeps the payload but commits enabled:false", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, css: "p{}" }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-disable"));
    expect(onCommit).toHaveBeenCalledWith({ enabled: false, css: "p{}" });
  });

  it("remove commits null (clears customCode entirely)", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, css: "p{}" }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-remove"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("does NOT expose an attributes editor (deferred in P23-D)", () => {
    renderField({ enabled: true, attributes: { "data-x": "y" } });
    expect(screen.queryByText(/attributes/i)).toBeNull();
    expect(screen.queryByTestId(/custom-code-attr/)).toBeNull();
    // Only the three code textareas exist.
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });
});

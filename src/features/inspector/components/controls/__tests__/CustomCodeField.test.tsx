// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P23-D + P23-F — CustomCodeField component
//   - no payload → Add custom code; enabling requires an explicit confirmation
//   - the confirmation carries the persistent warning; cancel never commits
//   - the warning stays visible (persistent) while custom code is enabled
//   - HTML/CSS/JS plain textareas commit on blur and preserve the enabled flag
//   - per-field counters (20k) and an aggregate counter (48k) are shown
//   - over-aggregate edits are blocked with an error (no commit)
//   - disable keeps the payload inert; remove commits null
//   - Phase P23-F — a safe Attributes authoring section: add/edit/remove
//     (name/value rows), empty state, per-row rejection of event handlers,
//     reserved shell attributes, malformed names, and javascript: URLs
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomCodeField, CUSTOM_CODE_WARNING } from "../CustomCodeField";
import type { InspectorFieldDef } from "@/features/elements/inspector/types";
import type { ElementCustomCode } from "@/features/elements/types";
import {
  ELEMENT_MAX_ATTRIBUTES,
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

describe("CustomCodeField — disable / remove (P23-D)", () => {
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
});

describe("CustomCodeField — attributes editor (P23-F)", () => {
  it("shows an empty state and an add button when no attributes exist", () => {
    renderField({ enabled: true });
    expect(screen.getByTestId("custom-code-attributes")).toBeTruthy();
    expect(screen.getByTestId("custom-code-attributes-empty")).toBeTruthy();
    expect(screen.getByTestId("custom-code-attr-add")).toBeTruthy();
    expect(screen.getByTestId("custom-code-attr-count").textContent).toContain("0 /");
  });

  it("renders existing attribute rows (sorted) from the payload", () => {
    renderField({ enabled: true, attributes: { "aria-label": "Widget", "data-id": "42" } });
    expect((screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement).value).toBe("aria-label");
    expect((screen.getByTestId("custom-code-attr-value-0") as HTMLInputElement).value).toBe("Widget");
    expect((screen.getByTestId("custom-code-attr-name-1") as HTMLInputElement).value).toBe("data-id");
    expect((screen.getByTestId("custom-code-attr-value-1") as HTMLInputElement).value).toBe("42");
  });

  it("adds an attribute and commits name + value", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, html: "<div></div>" }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-add"));
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    const valueInput = screen.getByTestId("custom-code-attr-value-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "data-x" } });
    fireEvent.blur(nameInput);
    expect(onCommit).toHaveBeenLastCalledWith({
      enabled: true,
      html: "<div></div>",
      attributes: { "data-x": "" },
    });
    fireEvent.change(valueInput, { target: { value: "y" } });
    fireEvent.blur(valueInput);
    expect(onCommit).toHaveBeenLastCalledWith({
      enabled: true,
      html: "<div></div>",
      attributes: { "data-x": "y" },
    });
  });

  it("edits an attribute value and commits", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, attributes: { "data-x": "y" } }, onCommit);
    const valueInput = screen.getByTestId("custom-code-attr-value-0") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "z" } });
    fireEvent.blur(valueInput);
    expect(onCommit).toHaveBeenCalledWith({
      enabled: true,
      attributes: { "data-x": "z" },
    });
  });

  it("renames an attribute (old key removed, value preserved)", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, attributes: { "data-x": "y" } }, onCommit);
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "data-y" } });
    fireEvent.blur(nameInput);
    expect(onCommit).toHaveBeenCalledWith({
      enabled: true,
      attributes: { "data-y": "y" },
    });
  });

  it("removes an attribute and commits the remaining set", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, attributes: { "aria-label": "w", "data-x": "y" } }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-remove-0")); // aria-label sorts first
    expect(onCommit).toHaveBeenCalledWith({
      enabled: true,
      attributes: { "data-x": "y" },
    });
  });

  it("removing the last attribute drops the attributes key", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, attributes: { "data-x": "y" } }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-remove-0"));
    expect(onCommit).toHaveBeenCalledWith({ enabled: true });
  });

  it("rejects an empty attribute name without committing", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-add"));
    fireEvent.blur(screen.getByTestId("custom-code-attr-name-0"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("custom-code-attr-error")).toBeTruthy();
  });

  it("rejects event-handler attribute names without committing", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-add"));
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "onclick" } });
    fireEvent.blur(nameInput);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("custom-code-attr-error").textContent).toContain("on");
  });

  it("rejects the reserved style attribute", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-add"));
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "style" } });
    fireEvent.blur(nameInput);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("custom-code-attr-error")).toBeTruthy();
  });

  it("rejects the reserved srcdoc attribute", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-add"));
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "srcdoc" } });
    fireEvent.blur(nameInput);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("custom-code-attr-error")).toBeTruthy();
  });

  it("rejects javascript: values for URL-bearing attributes without committing", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true }, onCommit);
    fireEvent.click(screen.getByTestId("custom-code-attr-add"));
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "href" } });
    fireEvent.blur(nameInput);
    expect(onCommit).toHaveBeenLastCalledWith({ enabled: true, attributes: { href: "" } });
    const valueInput = screen.getByTestId("custom-code-attr-value-0") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "javascript:alert(1)" } });
    fireEvent.blur(valueInput);
    expect(onCommit).toHaveBeenCalledTimes(1); // only the name commit went through
    expect(screen.getByTestId("custom-code-attr-error").textContent).toContain("javascript");
  });

  it("accepts legitimate aria-* and data-* attributes", () => {
    const onCommit = vi.fn(() => true);
    renderField({ enabled: true, attributes: { "data-id": "7" } }, onCommit);
    const nameInput = screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "aria-label" } });
    fireEvent.blur(nameInput);
    expect(onCommit).toHaveBeenLastCalledWith({
      enabled: true,
      attributes: { "aria-label": "7" },
    });
  });

  it("caps the attribute count at the schema limit", () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < ELEMENT_MAX_ATTRIBUTES; i += 1) attributes[`k${i}`] = "v";
    renderField({ enabled: true, attributes });
    const add = screen.getByTestId("custom-code-attr-add") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByTestId("custom-code-attr-count").textContent).toContain(
      `${ELEMENT_MAX_ATTRIBUTES} / ${ELEMENT_MAX_ATTRIBUTES}`,
    );
  });

  it("attribute edits preserve the code payload", () => {
    const onCommit = vi.fn(() => true);
    renderField(
      { enabled: true, html: "<p>hi</p>", css: "p {}", attributes: { "data-x": "y" } },
      onCommit,
    );
    const valueInput = screen.getByTestId("custom-code-attr-value-0") as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: "z" } });
    fireEvent.blur(valueInput);
    expect(onCommit).toHaveBeenCalledWith({
      enabled: true,
      html: "<p>hi</p>",
      css: "p {}",
      attributes: { "data-x": "z" },
    });
  });

  it("shows the attributes editor instead of hiding it (P23-F)", () => {
    renderField({ enabled: true, attributes: { "data-x": "y" } });
    expect(screen.getByTestId("custom-code-attributes")).toBeTruthy();
    expect((screen.getByTestId("custom-code-attr-name-0") as HTMLInputElement).value).toBe("data-x");
    expect((screen.getByTestId("custom-code-attr-value-0") as HTMLInputElement).value).toBe("y");
  });
});

describe("CustomCodeField — authoring preview toggle (P23-J)", () => {
  it("shows no preview toggle when no payload exists", () => {
    renderField(undefined);
    expect(screen.queryByTestId("custom-code-preview-toggle")).toBeNull();
  });

  it("shows no preview toggle for a disabled (legacy) payload", () => {
    renderField({ css: "p{}", js: "x()" });
    expect(screen.queryByTestId("custom-code-preview-toggle")).toBeNull();
  });

  it("shows a collapsed preview toggle for enabled code (inert until opened)", () => {
    renderField({ enabled: true, css: "p{}" });
    const toggle = screen.getByTestId("custom-code-preview-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("custom-code-preview-panel");
    // Collapsed by default — no iframe/runtime is mounted.
    expect(screen.queryByTestId("custom-code-preview")).toBeNull();
  });

  it("expands to mount the sandboxed preview and collapses to dispose it", () => {
    renderField({ enabled: true, css: "p{}", html: "<b>hi</b>" });
    const toggle = screen.getByTestId("custom-code-preview-toggle");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const preview = screen.getByTestId("custom-code-preview");
    const frame = preview.querySelector("iframe");
    expect(frame).toBeTruthy();
    // The preview uses the authoritative allow-scripts-only sandbox — never
    // allow-same-origin — and renders the export srcdoc data.
    expect(frame!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame!.getAttribute("sandbox")).not.toContain("allow-same-origin");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("custom-code-preview")).toBeNull();
  });
});

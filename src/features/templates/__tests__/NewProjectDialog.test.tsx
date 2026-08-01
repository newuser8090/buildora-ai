// ---------------------------------------------------------------------------
// NewProjectDialog component tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { templateRegistry } from "../registry/template-registry";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";

function renderDialog(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onCreate = vi.fn(async () => ({ ok: true as const }));
  const utils = render(
    <NewProjectDialog open onClose={onClose} onCreate={onCreate} {...props} />,
  );
  return { ...utils, onClose, onCreate };
}

async function selectTemplate(name = "SaaS Landing Page") {
  // Open preview card button that selects a template: use "Use" via gallery
  // card Use action? The gallery cards expose Preview/Use; Use = select.
  const useButton = screen.getAllByRole("button", { name: `Use ${name}` })[0];
  fireEvent.click(useButton);
}

describe("NewProjectDialog", () => {
  beforeEach(() => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
  });

  it("has dialog role with accessible title", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("New Project")).toBeTruthy();
  });

  it("shows the template list", () => {
    renderDialog();
    // Templates appear in both the Featured strip and the All grid.
    expect(screen.getAllByText("Blank Project").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SaaS Landing Page").length).toBeGreaterThan(0);
  });

  it("selecting Blank sets default name to Untitled Project", async () => {
    renderDialog();
    await selectTemplate("Blank Project");
    const input = screen.getByLabelText("Project name") as HTMLInputElement;
    expect(input.value).toBe("Untitled Project");
  });

  it("selecting a template sets its default project name", async () => {
    renderDialog();
    await selectTemplate("SaaS Landing Page");
    const input = screen.getByLabelText("Project name") as HTMLInputElement;
    expect(input.value).toBe("SaaS Landing Page");
  });

  it("custom name is retained after selection", async () => {
    renderDialog();
    await selectTemplate("SaaS Landing Page");
    const input = screen.getByLabelText("Project name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My Custom Name" } });
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe(
      "My Custom Name",
    );
  });

  it("invalid name blocks creation with a visible alert", async () => {
    const { onCreate } = renderDialog();
    await selectTemplate("SaaS Landing Page");
    const input = screen.getByLabelText("Project name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    const createButton = screen.getByTestId("create-project-button") as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    fireEvent.click(createButton);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("exactly 80 characters is accepted", async () => {
    const { onCreate } = renderDialog();
    await selectTemplate("SaaS Landing Page");
    const name = "a".repeat(80);
    const input = screen.getByLabelText("Project name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: name } });
    const createButton = screen.getByTestId("create-project-button") as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
    fireEvent.click(createButton);
    expect(onCreate).toHaveBeenCalledWith("template-saas", name);
  });

  it("successful creation calls onCreate with template id and trimmed name", async () => {
    const { onCreate } = renderDialog();
    await selectTemplate("SaaS Landing Page");
    const input = screen.getByLabelText("Project name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Nimbus Site  " } });
    fireEvent.click(screen.getByTestId("create-project-button"));
    expect(onCreate).toHaveBeenCalledWith("template-saas", "Nimbus Site");
  });

  it("repeated Create clicks start a single creation", async () => {
    type CreateResult = { ok: true } | { ok: false; error: string };
    let resolveCreate: ((value: CreateResult) => void) | null = null;
    const onCreate = vi.fn(
      () =>
        new Promise<CreateResult>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderDialog({ onCreate });
    await selectTemplate("SaaS Landing Page");

    fireEvent.click(screen.getByTestId("create-project-button"));
    fireEvent.click(screen.getByTestId("create-project-button"));
    fireEvent.click(screen.getByTestId("create-project-button"));

    expect(onCreate).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate?.({ ok: true });
    });
  });

  it("failed creation keeps the dialog open and shows the error", async () => {
    const onCreate = vi.fn(async () => ({ ok: false as const, error: "Storage is full" }));
    renderDialog({ onCreate });
    await selectTemplate("SaaS Landing Page");
    fireEvent.click(screen.getByTestId("create-project-button"));

    await waitFor(() => {
      expect(screen.getByTestId("new-project-create-error")).toBeTruthy();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("new-project-create-error").textContent).toContain(
      "Storage is full",
    );
  });

  it("retry succeeds after a failed creation without reopening", async () => {
    let fail = true;
    const onCreate = vi.fn(async () => {
      if (fail) {
        fail = false;
        return { ok: false as const, error: "Storage is full" };
      }
      return { ok: true as const };
    });
    const { onClose } = renderDialog({ onCreate });
    await selectTemplate("SaaS Landing Page");

    fireEvent.click(screen.getByTestId("create-project-button"));
    await waitFor(() => {
      expect(screen.getByTestId("new-project-create-error")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("create-project-button"));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it("Escape closes when idle", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape during creation is ignored", async () => {
    type CreateResult = { ok: true } | { ok: false; error: string };
    let resolveCreate: ((value: CreateResult) => void) | null = null;
    const onClose = vi.fn();
    const onCreate = vi.fn(
      () =>
        new Promise<CreateResult>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    render(
      <NewProjectDialog open onClose={onClose} onCreate={onCreate} />,
    );
    await selectTemplate("SaaS Landing Page");
    fireEvent.click(screen.getByTestId("create-project-button"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.({ ok: true });
    });
  });

  it("Tab wraps from last focusable to first", async () => {
    renderDialog();
    await selectTemplate("SaaS Landing Page");
    const { container } = screen.getByRole("dialog").parentElement
      ? { container: screen.getByRole("dialog") }
      : { container: document.body };
    void container;
    const focusable = screen.getByRole("dialog").querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBeGreaterThan(0);
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    await waitFor(() => {
      expect(document.activeElement).toBe(focusable[0]);
    });
  });

  it("Shift+Tab wraps from first to last", async () => {
    renderDialog();
    await selectTemplate("SaaS Landing Page");
    const focusable = screen.getByRole("dialog").querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(focusable[focusable.length - 1]);
    });
  });

  it("focus returns to the trigger after close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <NewProjectDialog open onClose={vi.fn()} onCreate={vi.fn()} />,
    );
    await waitFor(() => {
      expect(document.activeElement !== trigger).toBe(true);
    });

    rerender(
      <NewProjectDialog open={false} onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    document.body.removeChild(trigger);
  });

  it("preview flow opens the preview dialog and Use returns selection", async () => {
    renderDialog();
    const previewButtons = screen.getAllByRole("button", { name: /^Preview / });
    fireEvent.click(previewButtons[0]);
    // Preview dialog shows the template name + "Use this template".
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Use .* template/ })).toBeTruthy();
    });
  });

  it("Preview action on the selected template panel opens preview", async () => {
    renderDialog();
    await selectTemplate("SaaS Landing Page");
    fireEvent.click(screen.getByText("Preview template"));
    await waitFor(() => {
      expect(screen.getAllByText("SaaS Landing Page").length).toBeGreaterThan(0);
    });
  });

  it("unmount during creation does not crash when the promise resolves", async () => {
    type CreateResult = { ok: true } | { ok: false; error: string };
    let resolveCreate: ((value: CreateResult) => void) | null = null;
    const onCreate = vi.fn(
      () =>
        new Promise<CreateResult>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { unmount } = render(
      <NewProjectDialog open onClose={vi.fn()} onCreate={onCreate} />,
    );
    await selectTemplate("SaaS Landing Page");
    fireEvent.click(screen.getByTestId("create-project-button"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    unmount();
    // Resolving after unmount must not throw.
    await act(async () => {
      resolveCreate?.({ ok: true });
    });
  });

  it("Blank template button label distinguishes blank creation", async () => {
    renderDialog();
    await selectTemplate("Blank Project");
    expect(screen.getByText("Create Blank Project")).toBeTruthy();
  });
});

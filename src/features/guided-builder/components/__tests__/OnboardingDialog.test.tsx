// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// OnboardingDialog — component tests (Phase N, spec §28)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingDialog } from "../OnboardingDialog";

function renderDialog(overrides?: {
  onComplete?: () => Promise<{ ok: boolean; error?: string }>;
  onStartFromTemplate?: () => void;
}) {
  return render(
    <OnboardingDialog
      open
      onClose={vi.fn()}
      onComplete={overrides?.onComplete ?? vi.fn(async () => ({ ok: true }))}
      onStartFromTemplate={overrides?.onStartFromTemplate ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OnboardingDialog", () => {
  it("renders the welcome step first with a progress indicator", () => {
    renderDialog();
    expect(
      screen.getByRole("heading", { name: "Let’s turn your idea into a website" }),
    ).toBeTruthy();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    expect(screen.getByTestId("onboarding-skip")).toBeTruthy();
  });

  it("walks through the flow preserving choices", () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-category-business"));
    fireEvent.click(screen.getByTestId("onboarding-next"));

    fireEvent.click(screen.getByTestId("onboarding-begin-guided"));
    fireEvent.click(screen.getByTestId("onboarding-next"));

    expect(screen.getByText("Choose your comfort level")).toBeTruthy();
    fireEvent.click(screen.getByTestId("onboarding-comfort-new"));

    // Back preserves choices
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("How would you like to begin?")).toBeTruthy();
    const guided = screen.getByTestId("onboarding-begin-guided");
    expect(guided.getAttribute("aria-pressed")).toBe("true");
  });

  it("creates the project with the expected selections", async () => {
    const onComplete = vi.fn(async () => ({ ok: true }));
    renderDialog({ onComplete });

    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-category-restaurant"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-begin-ai"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-comfort-new"));

    fireEvent.click(screen.getByTestId("onboarding-next"));
    await screen.findByTestId("onboarding-next");
    expect(onComplete).toHaveBeenCalledWith({
      category: "restaurant",
      begin: "ai",
      comfort: "new",
    });
  });

  it("blocks repeated confirmation while creating", async () => {
    let resolveCreate: ((v: { ok: boolean; error?: string }) => void) | undefined;
    const onComplete = vi.fn(
      () =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderDialog({ onComplete });

    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-category-business"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-begin-blank"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-comfort-experienced"));

    const create = screen.getByTestId("onboarding-next");
    fireEvent.click(create);
    // The button is disabled while creating
    expect(create.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(create);
    expect(onComplete).toHaveBeenCalledTimes(1);

    resolveCreate?.({ ok: true });
    await screen.findByRole("button", { name: /Create my project/ });
  });

  it("shows an error and stays open when creation fails", async () => {
    const onComplete = vi.fn(async () => ({ ok: false, error: "Nope" }));
    renderDialog({ onComplete });

    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-category-business"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-begin-blank"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-comfort-experienced"));

    fireEvent.click(screen.getByTestId("onboarding-next"));
    await screen.findByTestId("onboarding-error");
    expect(screen.getByTestId("onboarding-error").textContent).toContain("Nope");
  });

  it("hands off to the template gallery when 'Start from a template' is chosen", () => {
    const onStartFromTemplate = vi.fn();
    renderDialog({ onStartFromTemplate });

    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-category-portfolio"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-begin-template"));
    fireEvent.click(screen.getByTestId("onboarding-next"));
    fireEvent.click(screen.getByTestId("onboarding-comfort-experienced"));

    fireEvent.click(screen.getByTestId("onboarding-next"));
    expect(onStartFromTemplate).toHaveBeenCalledWith({
      category: "portfolio",
      begin: "template",
      comfort: "experienced",
    });
  });

  it("can be skipped from the first step", () => {
    const onClose = vi.fn();
    render(
      <OnboardingDialog
        open
        onClose={onClose}
        onComplete={vi.fn(async () => ({ ok: true }))}
        onStartFromTemplate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("onboarding-skip"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

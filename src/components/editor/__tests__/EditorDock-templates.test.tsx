// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// EditorDock — Stage 2 Templates drawer integration tests
//
// Verifies the project-template picker inside the Templates drawer:
//  - Blank Canvas + curated cards render with the grocery template present
//  - 1-click creation goes through the canonical controller flow
//  - navigation happens only on success, to the /editor/[projectId] route
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditorDock } from "../EditorDock";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "@/features/templates/registry/register-default-templates";
import { templateRegistry } from "@/features/templates/registry/template-registry";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";

const { mockPush, mockCreate } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/features/persistence/hooks/useProjectController", () => ({
  ensureProjectController: () => ({
    createProjectFromTemplate: mockCreate,
  }),
}));

describe("EditorDock templates drawer (Stage 2)", () => {
  beforeEach(() => {
    // The dock drawer state lives in a global zustand store — reset it so
    // each test starts with the drawer closed (fresh-page semantics).
    useEditorUiStore.setState({ dockPanel: null });
    mockPush.mockClear();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      success: true,
      data: { projectId: "proj-new" },
    });
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
  });

  async function openTemplatesDrawer() {
    render(<EditorDock />);
    fireEvent.click(screen.getByTestId("dock-templates"));
    await screen.findByTestId("dock-drawer-templates");
  }

  it("surfaces Blank Canvas and the grocery template card", async () => {
    await openTemplatesDrawer();
    expect(screen.getByTestId("dock-template-blank")).toBeTruthy();
    expect(screen.getByTestId("dock-template-card-template-grocery")).toBeTruthy();
    expect(screen.getByText("Local Grocery Store")).toBeTruthy();
  });

  it("creates the grocery project through the controller and navigates", async () => {
    await openTemplatesDrawer();
    fireEvent.click(screen.getByTestId("dock-template-card-template-grocery"));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        templateId: "template-grocery",
        projectName: "Local Grocery Store",
      });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/editor/proj-new");
    });
  });

  it("Blank Canvas creates the blank template and navigates", async () => {
    await openTemplatesDrawer();
    fireEvent.click(screen.getByTestId("dock-template-blank"));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        templateId: "template-blank",
        projectName: "Untitled Project",
      });
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/editor/proj-new");
    });
  });

  it("does not navigate when creation fails", async () => {
    mockCreate.mockResolvedValue({
      success: false,
      error: { message: "Create failed" },
    });
    await openTemplatesDrawer();
    fireEvent.click(screen.getByTestId("dock-template-card-template-grocery"));
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

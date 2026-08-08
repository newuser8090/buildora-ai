// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — PersonalTemplatesPanel tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import "fake-indexeddb/auto";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { PersonalTemplatesPanel } from "../components/PersonalTemplatesPanel";
import { setPersonalTemplateServiceForTests } from "../services/personal-template-service";
import { usePersonalTemplatesUiStore } from "../store/personal-templates-ui-store";
import type { PersonalTemplateRecord } from "../types";
import type { Project } from "@/types/project";

function makeProject(name: string): Project {
  return {
    id: "proj-x",
    name,
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      { id: "p1", title: "Home", slug: "/", sections: [] },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRecord(overrides?: Partial<PersonalTemplateRecord>): PersonalTemplateRecord {
  return {
    id: "personal-1",
    name: "Portfolio Base",
    description: "A clean portfolio start",
    category: "portfolio",
    tags: ["portfolio", "starter"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "personal",
    project: makeProject("Portfolio Base"),
    ...overrides,
  };
}

/**
 * Stateful mock service — listTemplates reflects renames/deletes so the panel
 * can refresh after an action (matching the real service behavior).
 */
function makeStatefulService(initial: PersonalTemplateRecord[]) {
  const records = [...initial];
  return {
    records,
    listTemplates: vi.fn(async () => ({ ok: true, templates: [...records] })),
    deleteTemplate: vi.fn(async (id: string) => {
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) {
        return { ok: false, error: { code: "PERSONAL_TEMPLATE_NOT_FOUND", message: "Not found" } };
      }
      records.splice(index, 1);
      return { ok: true };
    }),
    renameTemplate: vi.fn(async (id: string, name: string) => {
      const rec = records.find((r) => r.id === id);
      if (!rec) {
        return { ok: false, error: { code: "PERSONAL_TEMPLATE_NOT_FOUND", message: "Not found" } };
      }
      const updated = { ...rec, name: name.trim() };
      records.splice(records.indexOf(rec), 1, updated);
      return { ok: true, record: updated };
    }),
    duplicateTemplate: vi.fn(async (id: string) => {
      const rec = records.find((r) => r.id === id);
      if (!rec) {
        return { ok: false, error: { code: "PERSONAL_TEMPLATE_NOT_FOUND", message: "Not found" } };
      }
      const copy = { ...rec, id: "personal-2", name: `${rec.name} Copy` };
      records.push(copy);
      return { ok: true, record: copy };
    }),
  };
}

describe("PersonalTemplatesPanel", () => {
  beforeEach(() => {
    cleanup();
    setPersonalTemplateServiceForTests(null);
    usePersonalTemplatesUiStore.setState({ libraryOpen: false, saveDialog: { open: false, project: null } });
  });

  it("lists saved templates and calls onUse for a template", async () => {
    setPersonalTemplateServiceForTests(makeStatefulService([makeRecord()]) as never);
    const onUse = vi.fn().mockResolvedValue({ ok: true });
    render(
      <PersonalTemplatesPanel
        open
        onClose={() => {}}
        onUse={onUse}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1));
    expect(screen.getByText("Portfolio Base")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Use Portfolio Base/i }));
    await waitFor(() => expect(onUse).toHaveBeenCalledWith("personal-1", "Portfolio Base"));
    expect(usePersonalTemplatesUiStore.getState().libraryOpen).toBe(false);
  });

  it("surfaces a use error without closing", async () => {
    setPersonalTemplateServiceForTests(makeStatefulService([makeRecord()]) as never);
    const onUse = vi.fn().mockResolvedValue({ ok: false, error: "Project create failed" });
    render(
      <PersonalTemplatesPanel
        open
        onClose={() => {}}
        onUse={onUse}
      />,
    );

    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Use Portfolio Base/i }));
    await waitFor(() =>
      expect(screen.getByTestId("personal-templates-error").textContent).toContain("Project create failed"),
    );
    // The panel stays open — the error is shown, not the dialog closed.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1);
  });

  it("filters by search across name, description, and tags", async () => {
    setPersonalTemplateServiceForTests(
      makeStatefulService([
        makeRecord({ id: "personal-1", name: "Portfolio Base", tags: ["portfolio"] }),
        makeRecord({ id: "personal-2", name: "Restaurant Site", description: "Menu pages", tags: ["food"] }),
      ]) as never,
    );
    render(
      <PersonalTemplatesPanel open onClose={() => {}} onUse={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(2));

    fireEvent.change(screen.getByLabelText(/Search your templates/i), {
      target: { value: "menu" },
    });
    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1));
    expect(screen.queryByText("Portfolio Base")).toBeNull();
  });

  it("shows a friendly empty state", async () => {
    setPersonalTemplateServiceForTests(makeStatefulService([]) as never);
    render(
      <PersonalTemplatesPanel open onClose={() => {}} onUse={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText("No saved templates yet")).toBeTruthy());
    expect(screen.getByText(/Save as template/)).toBeTruthy();
  });

  it("renames a template through the service", async () => {
    const service = makeStatefulService([makeRecord()]);
    setPersonalTemplateServiceForTests(service as never);
    render(
      <PersonalTemplatesPanel open onClose={() => {}} onUse={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Rename Portfolio Base/i }));
    const input = screen.getByLabelText(/Template name/i);
    fireEvent.change(input, { target: { value: "My New Template" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(service.renameTemplate).toHaveBeenCalledWith("personal-1", "My New Template"));
    await waitFor(() => expect(screen.getByText("My New Template")).toBeTruthy());
  });

  it("deletes a template after confirmation", async () => {
    const service = makeStatefulService([makeRecord()]);
    setPersonalTemplateServiceForTests(service as never);
    render(
      <PersonalTemplatesPanel open onClose={() => {}} onUse={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Delete Portfolio Base/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(service.deleteTemplate).toHaveBeenCalledWith("personal-1"));
    await waitFor(() => expect(screen.getByText("No saved templates yet")).toBeTruthy());
  });

  it("duplicates a template through the service", async () => {
    const service = makeStatefulService([makeRecord()]);
    setPersonalTemplateServiceForTests(service as never);
    render(
      <PersonalTemplatesPanel open onClose={() => {}} onUse={vi.fn().mockResolvedValue({ ok: true })} />,
    );

    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Duplicate Portfolio Base/i }));

    await waitFor(() => expect(service.duplicateTemplate).toHaveBeenCalledWith("personal-1"));
    await waitFor(() => expect(screen.getAllByTestId("personal-template-card")).toHaveLength(2));
  });
});

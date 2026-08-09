// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — ImportTemplateDialog component tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ImportTemplateDialog } from "../components/ImportTemplateDialog";
import { buildTemplateImportPreview, installImportedTemplate } from "../services/template-package-importer";
import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import type { Project } from "@/types/project";
import type { TemplateImportPreviewInfo } from "../types";

vi.mock("../services/template-package-importer", () => ({
  buildTemplateImportPreview: vi.fn(),
  installImportedTemplate: vi.fn(),
}));

vi.mock("@/features/personal-templates/services/personal-template-service", () => ({
  getPersonalTemplateService: () => ({
    listTemplates: vi.fn(async () => ({ ok: true, templates: [] })),
  }),
}));

vi.mock("@/features/perf/perf-instrumentation", () => ({
  markPerf: vi.fn(),
}));

const mockBuild = vi.mocked(buildTemplateImportPreview);
const mockInstall = vi.mocked(installImportedTemplate);

function makeProject(): Project {
  return {
    id: "proj-x",
    name: "Portfolio",
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
      { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hi" }, styles: {} }] },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRecord(): PersonalTemplateRecord {
  return {
    id: "personal-imported",
    name: "Portfolio",
    description: "A clean start",
    category: "portfolio",
    tags: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    source: "personal",
    provenance: { source: "import", packageFormatVersion: 1, exportedAt: "2026-08-09T00:00:00.000Z", originalName: "Portfolio" },
    project: makeProject(),
  };
}

function makePreviewInfo(overrides?: Partial<TemplateImportPreviewInfo>): TemplateImportPreviewInfo {
  return {
    name: "Portfolio",
    description: "A clean start",
    category: "portfolio",
    tags: [],
    pageCount: 1,
    sectionCount: 1,
    assetCount: 0,
    packageSizeBytes: 2048,
    formatVersion: 1,
    formatCompatible: true,
    warnings: [],
    originalName: "Portfolio",
    ...overrides,
  };
}

function renderDialog(overrides?: {
  onClose?: () => void;
  onInstalled?: (r: PersonalTemplateRecord) => void;
  onCreateProject?: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const onClose = overrides?.onClose ?? vi.fn();
  const onInstalled = overrides?.onInstalled ?? vi.fn();
  const onCreateProject = overrides?.onCreateProject ?? vi.fn();
  render(
    <ImportTemplateDialog
      open
      onClose={onClose}
      onInstalled={onInstalled}
      onCreateProject={onCreateProject}
    />,
  );
  return { onClose, onInstalled, onCreateProject };
}

async function selectFile(file: File) {
  const input = screen.getByTestId("template-import-file-input");
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  mockBuild.mockReset();
  mockInstall.mockReset();
  mockBuild.mockResolvedValue({
    ok: true,
    preview: makePreviewInfo(),
    record: makeRecord(),
  });
  mockInstall.mockResolvedValue({ ok: true, record: makeRecord() });
});

afterEach(() => {
  cleanup();
});

describe("ImportTemplateDialog", () => {
  it("renders the dropzone when open", () => {
    renderDialog();
    expect(screen.getByTestId("template-import-dropzone")).toBeTruthy();
    expect(screen.getByTestId("template-import-choose-file")).toBeTruthy();
  });

  it("shows the preview after selecting a file", async () => {
    renderDialog();
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-preview")).toBeTruthy());
    // The name appears in the heading (and the category label) — target the h3.
    expect(screen.getByText("Portfolio", { selector: "h3" })).toBeTruthy();
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });

  it("cancel in preview does not install and returns to the dropzone", async () => {
    renderDialog();
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-preview")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockInstall).not.toHaveBeenCalled();
    expect(screen.getByTestId("template-import-dropzone")).toBeTruthy();
  });

  it("installs on confirm and reports the installed record", async () => {
    const onInstalled = vi.fn();
    renderDialog({ onInstalled });
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-preview")).toBeTruthy());

    fireEvent.click(screen.getByTestId("template-import-install-button"));
    await waitFor(() => expect(screen.getByTestId("template-import-success")).toBeTruthy());
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(onInstalled).toHaveBeenCalledTimes(1);
  });

  it("guards against double-submission on install", async () => {
    let resolveInstall!: (v: { ok: true; record: PersonalTemplateRecord }) => void;
    mockInstall.mockReturnValue(
      new Promise((resolve) => {
        resolveInstall = resolve;
      }),
    );
    renderDialog();
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-preview")).toBeTruthy());

    const button = screen.getByTestId("template-import-install-button");
    fireEvent.click(button);
    fireEvent.click(button);
    resolveInstall({ ok: true, record: makeRecord() });
    await waitFor(() => expect(screen.getByTestId("template-import-success")).toBeTruthy());
    expect(mockInstall).toHaveBeenCalledTimes(1);
  });

  it("creates a project from the installed template", async () => {
    const onCreateProject = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    renderDialog({ onCreateProject, onClose });
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-preview")).toBeTruthy());
    fireEvent.click(screen.getByTestId("template-import-install-button"));
    await waitFor(() => expect(screen.getByTestId("template-import-success")).toBeTruthy());

    fireEvent.click(screen.getByTestId("template-import-create-project"));
    await waitFor(() => expect(onCreateProject).toHaveBeenCalledWith("personal-imported", "Portfolio"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a safe error message and does not install", async () => {
    mockBuild.mockResolvedValue({
      ok: false,
      error: { code: "FORMAT_TOO_NEW", message: "This template was created with a newer version of Buildora." },
    });
    renderDialog();
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-error")).toBeTruthy());
    expect(screen.getByText(/newer version of Buildora/)).toBeTruthy();
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it("shows a damaged-file error for invalid archives", async () => {
    mockBuild.mockResolvedValue({
      ok: false,
      error: { code: "ARCHIVE_INVALID", message: "This file is damaged or is not a Buildora template." },
    });
    renderDialog();
    await selectFile(new File(["x"], "t.buildora-template"));
    await waitFor(() => expect(screen.getByTestId("template-import-error")).toBeTruthy());
    expect(screen.getByText(/damaged or is not a Buildora template/)).toBeTruthy();
  });

  it("does not close on Escape while parsing", async () => {
    let resolveBuild!: (v: { ok: false; error: { code: "ARCHIVE_INVALID"; message: string } }) => void;
    mockBuild.mockReturnValue(
      new Promise((resolve) => {
        resolveBuild = resolve;
      }),
    );
    const onClose = vi.fn();
    renderDialog({ onClose });
    await selectFile(new File(["x"], "t.buildora-template"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolveBuild({ ok: false, error: { code: "ARCHIVE_INVALID", message: "nope" } });
    await waitFor(() => expect(screen.getByTestId("template-import-error")).toBeTruthy());
  });

  it("closes on Escape while idle", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("exposes a keyboard-accessible file input", () => {
    renderDialog();
    const input = screen.getByTestId("template-import-file-input");
    expect(input.getAttribute("accept")).toContain(".buildora-template");
    expect(input.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByTestId("template-import-choose-file")).toBeTruthy();
  });
});

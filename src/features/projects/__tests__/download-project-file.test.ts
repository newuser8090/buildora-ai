// ---------------------------------------------------------------------------
// downloadProjectFile tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { downloadProjectFile } from "../utils/download-project-file";

describe("downloadProjectFile", () => {
  const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
  const mockRevokeObjectURL = vi.fn();
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = mockCreateObjectURL;
    URL.revokeObjectURL = mockRevokeObjectURL;
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();

    // Remove any lingering anchors from previous tests
    document.body.innerHTML = "";
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("returns ok on success", () => {
    const result = downloadProjectFile("test.buildora.json", '{"hello":"world"}');
    expect(result.ok).toBe(true);
  });

  it("Blob created with correct MIME type", () => {
    const blobSpy = vi.spyOn(globalThis, "Blob");

    downloadProjectFile("test.buildora.json", "{}");

    expect(blobSpy).toHaveBeenCalledWith(["{}"], { type: "application/json" });
    blobSpy.mockRestore();
  });

  it("object URL created", () => {
    downloadProjectFile("test.buildora.json", "{}");
    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it("anchor download attribute set", () => {
    // Spy on createElement to capture the anchor
    const createElementSpy = vi.spyOn(document, "createElement");
    downloadProjectFile("test.buildora.json", "{}");

    expect(createElementSpy).toHaveBeenCalledWith("a");
    // Get the anchor that was created
    const anchorCall = createElementSpy.mock.results.find(
      (r) => r.value.tagName === "A",
    );
    expect(anchorCall).toBeTruthy();
    expect(anchorCall!.value.download).toBe("test.buildora.json");
    createElementSpy.mockRestore();
  });

  it("anchor clicked", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    downloadProjectFile("test.buildora.json", "{}");
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("anchor removed after click", () => {
    downloadProjectFile("test.buildora.json", "{}");
    // Anchor is removed in finally — verify no anchor in DOM
    const anchor = document.querySelector("a");
    expect(anchor).toBeNull();
  });

  it("URL revoked after click", () => {
    downloadProjectFile("test.buildora.json", "{}");
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("cleans up when click throws", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("Click failed");
      });

    const result = downloadProjectFile("test.buildora.json", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOWNLOAD_FAILED");
    }

    // Anchor should still be removed
    const anchor = document.querySelector("a");
    expect(anchor).toBeNull();

    // URL should still be revoked
    expect(mockRevokeObjectURL).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("returns error when browser APIs unavailable", () => {
    // Simulate non-browser environment
    const originalDoc = globalThis.document;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).document = undefined;

    const result = downloadProjectFile("test.buildora.json", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOWNLOAD_FAILED");
    }

    globalThis.document = originalDoc;
  });

  it("returns error when createElement unavailable", () => {
    const originalCreateElement = document.createElement;
    document.createElement = undefined as unknown as typeof document.createElement;

    const result = downloadProjectFile("test.buildora.json", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOWNLOAD_FAILED");
    }

    document.createElement = originalCreateElement;
  });
});

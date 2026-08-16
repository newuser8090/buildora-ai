// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P23-J/K — CustomCodePreview (safe authoring preview)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { CustomCodePreview } from "../CustomCodePreview";
import { buildValidatedCustomCodeSrcdoc } from "@/features/elements/custom-code/srcdoc";
import { SANDBOX_POLICY } from "@/features/elements/custom-code/sandbox-policy";
import {
  HEIGHT_COALESCE_MS,
  MAX_FRAME_HEIGHT_PX,
  RUNTIME_MESSAGE_TYPES,
} from "@/features/elements/custom-code/constants";
import type { ElementCustomCode } from "@/features/elements/types";

const ENABLED: ElementCustomCode = {
  enabled: true,
  html: "<span>hi</span>",
  css: "p { color: red; }",
  js: "console.log('p23j')",
};

function previewFrame(): HTMLIFrameElement {
  const preview = screen.getByTestId("custom-code-preview");
  const frame = preview.querySelector("iframe");
  expect(frame).not.toBeNull();
  return frame as HTMLIFrameElement;
}

function dispatchMessage(source: unknown, data: unknown): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: source as WindowProxy | null,
        data,
      }),
    );
  });
}

function ready(): unknown {
  return { type: RUNTIME_MESSAGE_TYPES.ready };
}

function height(height: number): unknown {
  return { type: RUNTIME_MESSAGE_TYPES.height, height };
}

function errorMsg(message: string): unknown {
  return { type: RUNTIME_MESSAGE_TYPES.error, error: { message } };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CustomCodePreview — inert when code is absent/disabled/malformed", () => {
  it("renders an inert note with no iframe for undefined code", () => {
    render(<CustomCodePreview code={undefined} />);
    expect(screen.getByTestId("custom-code-preview-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("custom-code-preview")).toBeNull();
  });

  it("renders an inert note with no iframe for disabled code", () => {
    render(<CustomCodePreview code={{ css: "p{}", js: "x()" }} />);
    expect(screen.getByTestId("custom-code-preview-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("custom-code-preview")).toBeNull();
  });

  it("renders an inert note with no iframe for malformed/oversized code", () => {
    render(<CustomCodePreview code={{ enabled: true, js: "x".repeat(20_001) }} />);
    expect(screen.getByTestId("custom-code-preview-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("custom-code-preview")).toBeNull();
  });
});

describe("CustomCodePreview — sandbox + srcdoc contract", () => {
  it("mounts ONE iframe with the authoritative allow-scripts-only sandbox", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    expect(frame.getAttribute("sandbox")).toBe(SANDBOX_POLICY);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("title")).toBe("Custom code preview");
    expect(frame.getAttribute("srcDoc")).toBe(buildValidatedCustomCodeSrcdoc(ENABLED));
  });

  it("never emits exec mechanisms or raw markup into the editor document", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const container = screen.getByTestId("custom-code-preview");
    expect(container.innerHTML).not.toContain("dangerouslySetInnerHTML");
    expect(container.innerHTML).not.toContain("eval(");
    expect(container.innerHTML).not.toContain("new Function");
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("keyed remount — a payload change deterministically replaces the frame", () => {
    const { rerender } = render(<CustomCodePreview code={ENABLED} />);
    const first = previewFrame();
    const firstDoc = first.getAttribute("srcDoc");

    const changed: ElementCustomCode = { ...ENABLED, js: "console.log('changed')" };
    rerender(<CustomCodePreview code={changed} />);
    const second = previewFrame();
    expect(firstDoc).not.toBe(buildValidatedCustomCodeSrcdoc(changed));
    expect(second).not.toBe(first);
    expect(second.getAttribute("srcDoc")).toBe(buildValidatedCustomCodeSrcdoc(changed));
  });
});

describe("CustomCodePreview — runtime wiring (source fencing + bounded height)", () => {
  it("anchors on a ready message from the frame's own contentWindow", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    expect(screen.getByTestId("custom-code-preview-status").textContent).toContain("Loading");

    dispatchMessage(frame.contentWindow, ready());
    expect(screen.getByTestId("custom-code-preview-status").textContent).toContain("Ready");
  });

  it("rejects a message from any other source — the frame stays mounting", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage({ self: "sibling" }, ready());
    dispatchMessage(null, ready());
    expect(screen.getByTestId("custom-code-preview-status").textContent).toContain("Loading");

    dispatchMessage(frame.contentWindow, ready());
    expect(screen.getByTestId("custom-code-preview-status").textContent).toContain("Ready");
  });

  it("applies validated heights through the coalesced scheduler (P23-I)", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage(frame.contentWindow, ready());
    dispatchMessage(frame.contentWindow, height(500));

    expect(frame.style.height).toBe("");
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(frame.style.height).toBe("500px");
    expect(frame.getAttribute("data-buildora-height")).toBe("500");
  });

  it("coalesces a burst of heights into at most one write (latest wins)", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage(frame.contentWindow, ready());

    dispatchMessage(frame.contentWindow, height(100));
    dispatchMessage(frame.contentWindow, height(200));
    dispatchMessage(frame.contentWindow, height(300));
    expect(frame.style.height).toBe("");
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(frame.style.height).toBe("300px");

    dispatchMessage(frame.contentWindow, height(300));
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(frame.style.height).toBe("300px");
  });

  it("clamps absurd heights at the shared cap via the protocol", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage(frame.contentWindow, ready());
    dispatchMessage(frame.contentWindow, height(999_999_999));
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(frame.style.height).toBe(`${MAX_FRAME_HEIGHT_PX}px`);
  });

  it("surfaces the sanitized runtime error as text and keeps the frame ready", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage(frame.contentWindow, ready());

    dispatchMessage(frame.contentWindow, errorMsg("boom"));
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(screen.getByTestId("custom-code-preview-error").textContent).toContain("boom");
    expect(frame.getAttribute("data-buildora-error")).toBe("1");
    expect(screen.getByTestId("custom-code-preview-status").textContent).toContain("Ready");

    dispatchMessage(frame.contentWindow, { type: "buildora:evil" });
    dispatchMessage(frame.contentWindow, errorMsg("x".repeat(10_000)));
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(
      screen.getByTestId("custom-code-preview-error").textContent!.length,
    ).toBeLessThanOrEqual(512 + "Runtime error: ".length);
  });

  it("coalesces repeated error reports and latest error wins (P23-K)", () => {
    render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage(frame.contentWindow, ready());

    dispatchMessage(frame.contentWindow, errorMsg("first"));
    dispatchMessage(frame.contentWindow, errorMsg("second"));
    dispatchMessage(frame.contentWindow, errorMsg("third"));

    // Accepted runtime errors are immediate at the controller boundary, but
    // the authoring UI has not rendered an error state before the coalesce
    // window expires.
    expect(screen.queryByTestId("custom-code-preview-error")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(screen.getByTestId("custom-code-preview-error").textContent).toContain("third");

    // Identical repeats are change-detected and do not create another UI
    // update window.
    dispatchMessage(frame.contentWindow, errorMsg("third"));
    act(() => {
      vi.advanceTimersByTime(HEIGHT_COALESCE_MS);
    });
    expect(screen.getByTestId("custom-code-preview-error").textContent).toContain("third");
  });

  it("unmount disposes the runtime — no timers or listeners leak", () => {
    const { unmount } = render(<CustomCodePreview code={ENABLED} />);
    const frame = previewFrame();
    dispatchMessage(frame.contentWindow, ready());
    dispatchMessage(frame.contentWindow, height(100));
    dispatchMessage(frame.contentWindow, errorMsg("pending"));

    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
    }).not.toThrow();
  });
});

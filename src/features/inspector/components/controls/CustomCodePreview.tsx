"use client";

// ---------------------------------------------------------------------------
// CustomCodePreview (Phase P23-J/K) — safe authoring preview for custom code
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import type { ElementCustomCode } from "@/features/elements/types";
import { buildValidatedCustomCodeSrcdoc } from "@/features/elements/custom-code/srcdoc";
import { buildSandboxPolicy } from "@/features/elements/custom-code/sandbox-policy";
import { HEIGHT_COALESCE_MS } from "@/features/elements/custom-code/constants";
import {
  createCustomCodeRuntime,
  type CustomCodeRuntimeState,
} from "@/features/elements/custom-code/runtime";

/** The ONLY sandbox capability the preview may grant (authoritative policy). */
const PREVIEW_SANDBOX = buildSandboxPolicy();

const STATUS_LABEL: Record<CustomCodeRuntimeState, string> = {
  idle: "Idle",
  mounting: "Loading…",
  ready: "Ready",
  unresponsive: "Unresponsive",
  recovering: "Recovering",
  disposed: "Stopped",
};

export interface CustomCodePreviewProps {
  /** The authored ElementCustomCode payload (whole object). */
  code: ElementCustomCode | null | undefined;
}

export function CustomCodePreview({ code }: CustomCodePreviewProps) {
  const srcdoc = useMemo(() => buildValidatedCustomCodeSrcdoc(code), [code]);

  if (srcdoc === null) {
    return (
      <div
        data-testid="custom-code-preview-unavailable"
        className="rounded-md border border-dashed border-border/70 bg-card/40 px-2.5 py-2 text-[11px] leading-snug text-text-dim/70"
      >
        Preview unavailable — enable custom code and keep HTML/CSS/JS within
        the size limits.
      </div>
    );
  }

  // Keying by srcdoc remounts a fresh frame + runtime for every payload change.
  return <CustomCodePreviewFrame key={srcdoc} srcdoc={srcdoc} />;
}

function CustomCodePreviewFrame({ srcdoc }: { srcdoc: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [status, setStatus] = useState<CustomCodeRuntimeState>("mounting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let pendingHeight: number | null = null;
    let heightTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingError: string | null = null;
    let errorTimer: ReturnType<typeof setTimeout> | undefined;

    const flushHeight = () => {
      heightTimer = undefined;
      if (pendingHeight === null) return;
      const next = pendingHeight;
      pendingHeight = null;
      setHeight((previous) => (previous === next ? previous : next));
    };

    const scheduleHeight = (nextHeight: number) => {
      if (pendingHeight === nextHeight) return;
      pendingHeight = nextHeight;
      if (heightTimer !== undefined) clearTimeout(heightTimer);
      heightTimer = setTimeout(flushHeight, HEIGHT_COALESCE_MS);
    };

    // P23-K: runtime errors are coalesced at the same bounded cadence as
    // heights. Runtime state/diagnostics remain immediate, but the authoring
    // UI performs at most one error-text state write per window. The latest
    // sanitized error wins, and identical repeats are ignored.
    const flushError = () => {
      errorTimer = undefined;
      const next = pendingError;
      pendingError = null;
      if (next === null) return;
      setErrorMessage((previous) => (previous === next ? previous : next));
    };

    const scheduleError = (message: string) => {
      if (pendingError === message) return;
      pendingError = message;
      if (errorTimer !== undefined) clearTimeout(errorTimer);
      errorTimer = setTimeout(flushError, HEIGHT_COALESCE_MS);
    };

    const runtime = createCustomCodeRuntime({
      getContentWindow: () => iframeRef.current?.contentWindow ?? null,
      onStateChange: (next) => setStatus(next),
      onHeight: (nextHeight) => scheduleHeight(nextHeight),
      onError: (error) => scheduleError(error.message),
    });

    const onMessage = (event: MessageEvent) => {
      try {
        runtime.handleMessage(event.source, event.data);
      } catch {
        // Contained — rejected/unknown messages never touch runtime state.
      }
    };

    window.addEventListener("message", onMessage);
    runtime.mount();

    return () => {
      window.removeEventListener("message", onMessage);
      runtime.dispose();
      if (heightTimer !== undefined) clearTimeout(heightTimer);
      if (errorTimer !== undefined) clearTimeout(errorTimer);
      heightTimer = undefined;
      errorTimer = undefined;
      pendingHeight = null;
      pendingError = null;
    };
  }, []);

  return (
    <div data-testid="custom-code-preview" className="space-y-1.5">
      <iframe
        ref={iframeRef}
        sandbox={PREVIEW_SANDBOX}
        srcDoc={srcdoc}
        title="Custom code preview"
        data-buildora-status={status}
        data-buildora-error={errorMessage !== null ? "1" : undefined}
        data-buildora-height={height === null ? undefined : height}
        style={{
          width: "100%",
          border: "1px solid var(--border, #e5e5e5)",
          borderRadius: "0.5rem",
          display: "block",
          background: "var(--card, #ffffff)",
          ...(height === null ? { minHeight: 96 } : { height }),
        }}
      />
      <div className="flex items-center gap-2 text-[10px] text-text-dim/70">
        <span
          data-testid="custom-code-preview-status"
          className="uppercase tracking-wider"
        >
          {STATUS_LABEL[status]}
        </span>
        {errorMessage !== null && (
          <span
            data-testid="custom-code-preview-error"
            className="truncate text-red-400"
          >
            Runtime error: {errorMessage}
          </span>
        )}
      </div>
    </div>
  );
}

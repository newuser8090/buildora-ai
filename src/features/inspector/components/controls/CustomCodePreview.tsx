"use client";

// ---------------------------------------------------------------------------
// CustomCodePreview (Phase P23-J) — safe authoring preview for custom code
//
// Renders the EXACT document the published site will execute — built through
// the SINGLE authoritative srcdoc path (buildValidatedCustomCodeSrcdoc:
// schema validation → explicit `enabled === true` → deterministic clamping →
// buildCustomCodeDocument) — inside the SAME sandboxed iframe the export
// uses (allow-scripts ONLY; opaque origin; never allow-same-origin).
//
// Security/isolation contract (all inherited from the tested runtime
// foundation — nothing here invents new policy):
//   - The editor document stays INERT: custom code executes only inside this
//     sandboxed frame, never in the editor page itself. The canvas
//     BlockRenderer placeholder is unchanged.
//   - The frame carries the authoritative SANDBOX_POLICY ("allow-scripts")
//     and the srcdoc carries the approved SANDBOX_CSP.
//   - The parent-side runtime controller (createCustomCodeRuntime, P23-G/H)
//     is wired in for the first time: source fencing (only THIS frame's
//     contentWindow may drive the runtime), allow-listed payload validation,
//     one bounded heartbeat, bounded recovery, idempotent disposal.
//   - Per-instance isolation (P23-G/I): the frame is keyed by its srcdoc, so
//     ANY payload change (html/css/js/attributes/enabled) remounts a fresh
//     frame and deterministically disposes the previous runtime.
//   - Bounded height propagation (P23-I): validated heights are
//     change-detected and coalesced into at most ONE write per
//     HEIGHT_COALESCE_MS window (reuses the shared constant — no duplicated
//     policy).
//   - Safe observability (P23-H): only the lifecycle status and the
//     protocol-sanitized error message surface; never raw payloads,
//     exception objects, or frame references.
//   - No eval, no new Function, no dangerouslySetInnerHTML, no global
//     runtime state — every timer/listener is owned by one mount and cleared
//     on unmount.
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

  // Disabled/absent/malformed code produces NO runtime document — the preview
  // is inert and explains why (never a blank or executing frame).
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

  // Keying by the srcdoc remounts a FRESH frame + runtime on every payload
  // change, so a stale instance can never affect the new one (P23-G/I).
  return <CustomCodePreviewFrame key={srcdoc} srcdoc={srcdoc} />;
}

function CustomCodePreviewFrame({ srcdoc }: { srcdoc: string }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [status, setStatus] = useState<CustomCodeRuntimeState>("mounting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Per-mount height scheduler (P23-I): validated heights are
    // change-detected and coalesced into at most ONE state write per
    // HEIGHT_COALESCE_MS window, so a chatty/hostile frame cannot cause
    // layout thrashing or unbounded re-renders. The latest height always
    // wins; normal dynamic resizing is preserved.
    let pendingHeight: number | null = null;
    let heightTimer: ReturnType<typeof setTimeout> | undefined;

    const flushHeight = () => {
      heightTimer = undefined;
      if (pendingHeight === null) return;
      const next = pendingHeight;
      pendingHeight = null;
      setHeight(next);
    };

    const scheduleHeight = (h: number) => {
      if (pendingHeight === h) return; // change detection — no-op repeats
      pendingHeight = h;
      if (heightTimer !== undefined) clearTimeout(heightTimer);
      heightTimer = setTimeout(flushHeight, HEIGHT_COALESCE_MS);
    };

    // One runtime controller per mount (the tested P23-G/H reference). The
    // content window is read FRESH for every message so the source check
    // always compares against the CURRENT frame — a replaced frame's old
    // window can never match.
    const runtime = createCustomCodeRuntime({
      getContentWindow: () => iframeRef.current?.contentWindow ?? null,
      onStateChange: (next) => setStatus(next),
      onHeight: (h) => scheduleHeight(h),
      onError: (error) => setErrorMessage(error.message),
    });

    const onMessage = (event: MessageEvent) => {
      // P23-I containment: a hostile/throwable event must never escape as an
      // uncaught exception into the editor application.
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
      heightTimer = undefined;
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

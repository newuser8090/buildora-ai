"use client";

// ---------------------------------------------------------------------------
// PublishSuccessModal (Stage 5) — one-click publish celebration
//
// Opens from the TopNav's Canva-purple Publish button. Shows the live
// shareable URL (origin + /preview/<projectId>), a "Copy Link" button with
// instant "Copied!" feedback, a scannable QR code (dependency-free encoder)
// for phone-camera access to the mobile site, and an "Open Live Site" primary
// CTA in a new tab. Transient UI state only — no durable schema changes.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, PartyPopper, X } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { buildQrMatrix } from "../utils/qr-code";

/** The canonical live preview URL for a project. */
export function buildLivePreviewUrl(projectId: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://app.buildora.dev";
  return `${origin}/preview/${projectId}`;
}

/** Crisp SVG QR code rendering of `text` (dependency-free). */
function QrCodeSvg({ text, size = 148 }: { text: string; size?: number }) {
  const matrix = useMemo(() => {
    try {
      return buildQrMatrix(text);
    } catch {
      return null;
    }
  }, [text]);

  if (!matrix) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-[#F2F3F5] text-xs text-[#8a8f9c]"
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  const path = matrix.modules
    .map((row, y) =>
      row
        .map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ""))
        .join(""),
    )
    .join("");

  return (
    <svg
      role="img"
      aria-label="QR code linking to the live site"
      data-testid="publish-qr"
      viewBox={`0 0 ${matrix.size} ${matrix.size}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white"
    >
      <path d={path} fill="#0d0f14" />
    </svg>
  );
}

export function PublishSuccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useEditorStore((s) => s.project.id);
  const [copied, setCopied] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const liveUrl = useMemo(
    () => (open && projectId ? buildLivePreviewUrl(projectId) : ""),
    [open, projectId],
  );

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    previousFocusRef.current?.focus();
    return undefined;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
  }, [open, onClose]);

  if (!open) return null;

  const copyLink = () => {
    try {
      void navigator.clipboard?.writeText(liveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the URL stays visible for manual copying.
    }
  };

  return (
    <div className="fixed inset-0 z-[70]" data-testid="publish-modal-root">
      <div
        data-testid="publish-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your website is live"
        data-testid="publish-modal"
        className="absolute left-1/2 top-1/2 w-[400px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(0,0,0,0.2)]"
      >
        {/* Header */}
        <div className="relative flex items-center justify-center px-5 pt-6 pb-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close publish dialog"
            data-testid="publish-close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#8a8f9c] transition-colors hover:bg-[#F2F3F5] hover:text-[#0d0f14]"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#8B3DFF] to-[#7D2AE8] shadow-[0_4px_16px_rgba(125,42,232,0.35)]">
              <PartyPopper className="h-6 w-6 text-white" />
            </span>
            <h2 className="text-lg font-semibold text-[#0d0f14]">Your website is live!</h2>
            <p className="text-xs text-[#8a8f9c]">
              Share it with anyone — it looks great on every screen.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-col items-center gap-4 px-5 pb-5">
          {/* URL + copy */}
          <div className="flex w-full items-center gap-2 rounded-xl border border-black/10 px-3 py-2">
            <span
              data-testid="publish-live-url"
              className="min-w-0 flex-1 truncate text-xs text-[#5b5e69]"
              title={liveUrl}
            >
              {liveUrl}
            </span>
            <button
              type="button"
              data-testid="publish-copy-link"
              onClick={copyLink}
              aria-label="Copy link"
              className={`flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors ${
                copied
                  ? "bg-green-50 text-green-600"
                  : "bg-[#F2F3F5] text-[#0d0f14] hover:bg-[#e8eaef]"
              }`}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>

          {/* QR + hint */}
          <div className="flex items-center gap-3">
            <QrCodeSvg text={liveUrl} />
            <p className="max-w-[150px] text-xs leading-relaxed text-[#8a8f9c]">
              Scan with your phone camera to view your mobile site live.
            </p>
          </div>

          {/* Primary CTA */}
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="publish-open-live"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8B3DFF] to-[#7D2AE8] text-sm font-semibold text-white shadow-[0_2px_10px_rgba(125,42,232,0.35)] transition-all hover:brightness-110 active:scale-[0.99]"
          >
            <ExternalLink className="h-4 w-4" />
            Open Live Site
          </a>
        </div>
      </div>
    </div>
  );
}

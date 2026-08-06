"use client";

// ---------------------------------------------------------------------------
// MyBlocksToast — polite status announcements for library actions
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";

export function MyBlocksToast() {
  const toast = useMyBlocksUiStore((s) => s.toast);
  const clearToast = useMyBlocksUiStore((s) => s.clearToast);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!toast) return;
    timerRef.current = setTimeout(() => {
      clearToast();
      timerRef.current = null;
    }, 3200);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="my-blocks-toast"
      className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-text-primary shadow-elevated"
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
      {toast}
    </div>
  );
}

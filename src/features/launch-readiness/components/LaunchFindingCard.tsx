"use client";

// ---------------------------------------------------------------------------
// LaunchFindingCard — one warning/fail with a one-click fix action
// ---------------------------------------------------------------------------

import { AlertTriangle, XCircle, Wrench } from "lucide-react";
import type { LaunchCheck } from "../types";

export interface LaunchFindingCardProps {
  check: LaunchCheck;
  onFix: (check: LaunchCheck) => void;
}

export function LaunchFindingCard({ check, onFix }: LaunchFindingCardProps) {
  const isFail = check.status === "fail";
  const Icon = isFail ? XCircle : AlertTriangle;

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 ${
        isFail
          ? "border-red-500/25 bg-red-500/5"
          : "border-amber-500/25 bg-amber-500/5"
      }`}
      data-testid="launch-finding"
    >
      <Icon
        className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
          isFail ? "text-red-400" : "text-amber-400"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{check.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
          {check.explanation}
        </p>
        {check.affected && (
          <p className="mt-0.5 text-[11px] text-text-dim">{check.affected}</p>
        )}
        <p className="mt-1 text-[11px] text-accent">{check.suggestedAction}</p>
      </div>
      {check.fixActionId && (
        <button
          onClick={() => onFix(check)}
          className="flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
          type="button"
          data-testid="launch-fix-action"
        >
          <Wrench className="h-3 w-3" />
          Fix
        </button>
      )}
    </div>
  );
}

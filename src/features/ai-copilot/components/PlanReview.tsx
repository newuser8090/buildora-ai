"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type { AiEditDiff, AiEditOperation, AiEditPlan } from "@/features/ai-editing/plan-types";
import { copilotScopeLabel } from "../types";
import { cn } from "@/utils/cn";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  try {
    const json = JSON.stringify(value);
    return json.length > 120 ? `${json.slice(0, 120)}…` : json;
  } catch {
    return String(value);
  }
}

function riskBadge(risk: AiEditOperation["risk"]) {
  switch (risk) {
    case "high":
      return { label: "Destructive", className: "border-red-500/40 bg-red-500/10 text-red-300" };
    case "medium":
      return { label: "Medium", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
    default:
      return { label: "Low", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
  }
}

function DiffBlock({ diff }: { diff: AiEditDiff | undefined }) {
  if (!diff || diff.fields.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border/60 bg-base/60 px-3 py-2 text-xs text-text-dim">
        Structural change — no text preview available.
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {diff.fields.map((field) => (
        <div key={field.key} className="rounded-lg border border-border/60 bg-base/60 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
            {field.label}
          </div>
          {field.before !== undefined && (
            <div className="mt-0.5 break-words text-xs text-red-300/90 line-through">
              {formatValue(field.before)}
            </div>
          )}
          {field.after !== undefined && (
            <div className="mt-0.5 break-words text-xs text-emerald-300/90">
              {field.before !== undefined ? "→ " : ""}
              {formatValue(field.after)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface OperationRowProps {
  op: AiEditOperation;
  checked: boolean;
  disabled: boolean;
  dependencyLabel: string | null;
  diff: AiEditDiff | undefined;
  onToggle: () => void;
}

function OperationRow({ op, checked, disabled, dependencyLabel, diff, onToggle }: OperationRowProps) {
  const [expanded, setExpanded] = useState(false);
  const badge = riskBadge(op.risk);

  return (
    <div
      data-testid={`copilot-op-${op.id}`}
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors duration-200",
        checked ? "border-accent/25 bg-accent/[0.03]" : "border-border bg-base/40",
      )}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          data-testid={`copilot-op-checkbox-${op.id}`}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Select: ${op.label}`}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-text-primary">{op.label}</span>
            <span
              data-testid={`copilot-op-risk-${op.id}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                badge.className,
              )}
            >
              {op.risk === "high" && <ShieldAlert className="h-2.5 w-2.5" />}
              {badge.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{op.explanation}</p>
          {dependencyLabel && (
            <p className="mt-1 text-[10px] text-text-dim">Depends on: {dependencyLabel}</p>
          )}
        </div>
        {diff && diff.fields.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide preview" : "Show preview"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {expanded && <DiffBlock diff={diff} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review card
// ---------------------------------------------------------------------------

export interface PlanReviewProps {
  plan: AiEditPlan;
  diffs: AiEditDiff[];
  selectedOperationIds: string[];
  warnings: string[];
  applying: boolean;
  onToggleOperation: (op: AiEditOperation) => void;
  onApply: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
}

export function PlanReview({
  plan,
  diffs,
  selectedOperationIds,
  warnings,
  applying,
  onToggleOperation,
  onApply,
  onRegenerate,
  onCancel,
}: PlanReviewProps) {
  const diffByOp = useMemo(() => {
    const map = new Map<string, AiEditDiff>();
    for (const diff of diffs) map.set(diff.operationId, diff);
    return map;
  }, [diffs]);

  const selectedSet = useMemo(() => new Set(selectedOperationIds), [selectedOperationIds]);
  const ops = plan.operations;
  const selectedCount = ops.filter((op) => selectedSet.has(op.id)).length;

  const dependencyIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const op of ops) {
      if (op.dependsOn && op.dependsOn.length > 0) map.set(op.id, op.dependsOn);
    }
    return map;
  }, [ops]);

  const isDisabled = (op: AiEditOperation): boolean =>
    (dependencyIds.get(op.id) ?? []).some((dep) => !selectedSet.has(dep));

  const dependencyLabel = (op: AiEditOperation): string | null => {
    const deps = dependencyIds.get(op.id) ?? [];
    if (deps.length === 0) return null;
    return deps.map((dep) => ops.find((o) => o.id === dep)?.label ?? dep).join(", ");
  };

  return (
    <div
      data-testid="copilot-plan-review"
      className="mb-3 rounded-2xl border border-accent/25 bg-accent/[0.04] p-3.5"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" />
        <h3 className="flex-1 text-sm font-semibold text-text-primary">
          AI suggests {ops.length} change{ops.length === 1 ? "" : "s"}
        </h3>
        <span className="rounded bg-base px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-dim">
          {plan.provider === "rule-based" ? "local engine" : "AI"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-text-dim">
        Acting on {copilotScopeLabel(plan.scope)} — review before applying.
      </p>

      {warnings.length > 0 && (
        <div role="status" className="mt-2.5 flex flex-col gap-1 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2">
          {warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-200/90">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-col gap-1.5">
        {ops.map((op) => {
          const disabled = isDisabled(op);
          const checked = !disabled && selectedSet.has(op.id);
          return (
            <OperationRow
              key={op.id}
              op={op}
              checked={checked}
              disabled={disabled}
              dependencyLabel={dependencyLabel(op)}
              diff={diffByOp.get(op.id)}
              onToggle={() => onToggleOperation(op)}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="copilot-apply"
          onClick={onApply}
          disabled={applying || selectedCount === 0}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {applying ? "Applying..." : `Apply ${selectedCount > 0 ? `(${selectedCount})` : ""}`}
        </button>
        <button
          type="button"
          data-testid="copilot-regenerate"
          onClick={onRegenerate}
          disabled={applying}
          className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          title="Prepare a new suggestion"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
        <button
          type="button"
          data-testid="copilot-cancel-plan"
          onClick={onCancel}
          disabled={applying}
          className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

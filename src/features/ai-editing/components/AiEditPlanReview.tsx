"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAiPlanEdit } from "../hooks/useAiPlanEdit";
import { scopeLabel } from "../plan-types";
import type {
  AiEditDiff,
  AiEditOperation,
  AiEditPlan,
} from "../plan-types";
import { cn } from "@/utils/cn";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function riskBadge(risk: AiEditOperation["risk"]) {
  switch (risk) {
    case "high":
      return {
        label: "Destructive",
        className:
          "border-red-500/40 bg-red-500/10 text-red-300",
      };
    case "medium":
      return {
        label: "Medium",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
      };
    default:
      return {
        label: "Low",
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      };
  }
}

function opSummary(op: AiEditOperation, plan: AiEditPlan): string {
  switch (op.type) {
    case "update-section-props":
    case "update-section-styles":
    case "set-section-visibility": {
      const page = plan.scope.type === "project"
        ? "page"
        : plan.scope.pageId === op.pageId
          ? "this page"
          : "a page";
      return `${page} · section ${op.sectionId ?? "?"}`;
    }
    case "insert-section":
    case "delete-section":
    case "duplicate-section":
    case "move-section":
      return `page ${op.pageId ?? "?"}`;
    case "add-page":
      return `new page · ${op.page.title}`;
    case "rename-page":
    case "delete-page":
    case "move-page":
    case "update-page-meta":
      return `page ${op.pageId ?? "?"}`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

function DiffView({ diff }: { diff: AiEditDiff | undefined }) {
  if (!diff || diff.fields.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border/60 bg-base/60 px-3 py-2 text-xs text-text-dim">
        Structural change — no inline fields.
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {diff.fields.map((field) => (
        <div
          key={field.key}
          className="rounded-lg border border-border/60 bg-base/60 px-3 py-2"
        >
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

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  try {
    const json = JSON.stringify(value);
    return json.length > 120 ? `${json.slice(0, 120)}…` : json;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Operation card
// ---------------------------------------------------------------------------

interface OperationCardProps {
  op: AiEditOperation;
  plan: AiEditPlan;
  checked: boolean;
  disabled: boolean;
  dependencyLabel: string | null;
  diff: AiEditDiff | undefined;
  onToggle: () => void;
}

function OperationCard({
  op,
  plan,
  checked,
  disabled,
  dependencyLabel,
  diff,
  onToggle,
}: OperationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const badge = riskBadge(op.risk);

  return (
    <div
      data-testid={`plan-op-${op.id}`}
      className={cn(
        "rounded-xl border px-3.5 py-3 transition-colors duration-200",
        checked
          ? "border-accent/25 bg-accent/[0.03]"
          : "border-border bg-base/40",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          data-testid={`plan-op-checkbox-${op.id}`}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Select: ${op.label}`}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">
              {op.label}
            </span>
            <span
              data-testid={`plan-op-risk-${op.id}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                badge.className,
              )}
            >
              {op.risk === "high" && <ShieldAlert className="h-3 w-3" />}
              {badge.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {op.explanation}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-text-dim/60">
            {opSummary(op, plan)}
          </p>
          {dependencyLabel && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-md border border-border bg-base px-1.5 py-0.5 text-[10px] text-text-dim">
              <ClipboardList className="h-3 w-3" />
              Depends on: {dependencyLabel}
            </p>
          )}
        </div>
        {diff && diff.fields.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide diff" : "Show diff"}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <DiffView diff={diff} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review panel
// ---------------------------------------------------------------------------

interface AiEditPlanReviewProps {
  /**
   * The sidebar remounts the panel with a fresh key when the user asks to
   * review a plan again, so dismissal state never leaks between opens.
   */
  reopenKey?: string;
}

// The sidebar remounts us with a fresh key to force a re-open, so the
// dismissal state is always scoped to the current mount + plan id.
export function AiEditPlanReview({ reopenKey: _reopenKey }: AiEditPlanReviewProps) {
  const {
    status,
    plan,
    selectedOperationIds,
    diffs,
    warnings,
    error,
    applyPlan,
    rejectPlan,
    regenerate,
    setSelectedOperationIds,
    isBusy,
  } = useAiPlanEdit();

  // Dismissal is scoped to the current plan id — a regenerated plan (new id)
  // always opens; the sidebar remounts via reopenKey to force a re-open.
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null);
  const [confirmDestructive, setConfirmDestructive] = useState(false);
  const [pendingApplyAll, setPendingApplyAll] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const planVisible =
    plan !== null &&
    (status === "ready" ||
      status === "applying" ||
      status === "error" ||
      status === "stale");

  const dismissed = plan !== null && dismissedPlanId === plan.id;
  const open = planVisible && !dismissed;
  const isApplying = status === "applying";

  // Focus management + Escape (only when not applying).
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog) dialog.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isApplying) return;
        e.stopPropagation();
        setDismissedPlanId(plan?.id ?? null);
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, isApplying, plan?.id]);

  const ops = useMemo(() => plan?.operations ?? [], [plan]);
  const diffByOp = useMemo(() => {
    const map = new Map<string, AiEditDiff>();
    for (const diff of diffs) map.set(diff.operationId, diff);
    return map;
  }, [diffs]);

  const selectedSet = useMemo(
    () => new Set(selectedOperationIds),
    [selectedOperationIds],
  );
  const selectedOps = useMemo(
    () => (plan ? plan.operations.filter((op) => selectedSet.has(op.id)) : []),
    [plan, selectedSet],
  );
  const toggleOperation = (op: AiEditOperation) => {
    const next = new Set(selectedOperationIds);
    if (next.has(op.id)) {
      next.delete(op.id);
    } else {
      next.add(op.id);
    }
    setSelectedOperationIds(Array.from(next));
    setConfirmDestructive(false);
  };

  const dependencyIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const op of ops) {
      if (op.dependsOn && op.dependsOn.length > 0) {
        map.set(op.id, op.dependsOn);
      }
    }
    return map;
  }, [ops]);

  const opDisabled = (op: AiEditOperation): boolean => {
    const deps = dependencyIds.get(op.id) ?? [];
    return deps.some((dep) => !selectedSet.has(dep));
  };

  const dependencyLabel = (op: AiEditOperation): string | null => {
    const deps = dependencyIds.get(op.id) ?? [];
    if (deps.length === 0) return null;
    return deps
      .map((dep) => ops.find((o) => o.id === dep)?.label ?? dep)
      .join(", ");
  };

  const handleApply = async (all: boolean) => {
    const willApplyDestructive = all
      ? ops.some((o) => o.risk === "high")
      : selectedOps.some((o) => o.risk === "high");

    if (willApplyDestructive && !confirmDestructive) {
      setPendingApplyAll(all);
      setConfirmDestructive(true);
      return;
    }
    setConfirmDestructive(false);
    setPendingApplyAll(false);
    await applyPlan(all ? null : selectedOperationIds, {
      allowDestructive: true,
    });
  };

  if (!open) return null;

  const isStale = status === "stale";
  const destructiveCount = pendingApplyAll
    ? ops.filter((o) => o.risk === "high").length
    : selectedOps.filter((o) => o.risk === "high").length;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-labelledby="ai-plan-review-title"
      data-testid="ai-plan-review"
    >
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="pointer-events-auto flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated outline-none"
        data-testid="ai-plan-review-panel"
      >
        {/* ---- Header ---- */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
              <Sparkles className="h-4.5 w-4.5 text-accent" />
            </div>
            <div>
              <h3
                id="ai-plan-review-title"
                className="text-base font-semibold text-text-primary"
              >
                Review AI changes
              </h3>
              <p className="text-xs text-text-dim">
                {plan
                  ? `${scopeLabel(plan.scope)} · ${ops.length} proposed change${ops.length === 1 ? "" : "s"} · revision ${plan.baseRevision}`
                  : "Plan"}{" "}
                {plan && (
                  <span className="ml-1 rounded bg-base px-1 py-0.5 text-[10px] uppercase tracking-wide text-text-dim">
                    {plan.provider}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedPlanId(plan?.id ?? null)}
            disabled={isApplying}
            aria-label="Close review (plan is kept)"
            data-testid="plan-review-close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ---- Instruction + summary ---- */}
          {plan && (
            <div className="mb-3">
              <p className="text-sm font-medium text-text-primary">
                {plan.summary}
              </p>
              <p className="mt-1 text-xs italic leading-relaxed text-text-dim">
                “{plan.instruction}”
              </p>
            </div>
          )}

          {/* ---- Warnings ---- */}
          {warnings.length > 0 && (
            <div
              role="status"
              className="mb-3 flex flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-2.5"
            >
              {warnings.map((w, i) => (
                <p
                  key={i}
                  className="flex items-start gap-2 text-xs text-amber-200/90"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* ---- Stale banner ---- */}
          {isStale && (
            <div
              role="alert"
              data-testid="plan-stale-banner"
              className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
            >
              <p className="flex items-start gap-2 text-sm font-medium text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This project changed since the plan was created. Apply a fresh
                plan instead.
              </p>
              <div className="flex items-center gap-2 pl-6">
                <button
                  type="button"
                  onClick={() => regenerate()}
                  disabled={isBusy}
                  data-testid="plan-regenerate"
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40"
                >
                  {isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Regenerate Plan
                </button>
                <button
                  type="button"
                  onClick={rejectPlan}
                  data-testid="plan-discard"
                  className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* ---- Apply error (review stays open) ---- */}
          {!isStale && error && (
            <div
              role="alert"
              data-testid="plan-apply-error"
              className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            >
              {error.message}
            </div>
          )}

          {/* ---- Operation list ---- */}
          {!isStale && (
            <div className="flex flex-col gap-2">
              {ops.map((op) => {
                const disabled = opDisabled(op);
                const checked = !disabled && selectedSet.has(op.id);
                return (
                  <OperationCard
                    key={op.id}
                    op={op}
                    plan={plan}
                    checked={checked}
                    disabled={disabled}
                    dependencyLabel={dependencyLabel(op)}
                    diff={diffByOp.get(op.id)}
                    onToggle={() => toggleOperation(op)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ---- Footer actions ---- */}
        <div className="border-t border-border px-5 py-4">
          {!isStale && (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-text-dim">
                <span>
                  <span data-testid="plan-selected-count">
                    {selectedOps.length}
                  </span>{" "}
                  of {ops.length} selected
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOperationIds(ops.map((o) => o.id));
                    setConfirmDestructive(false);
                  }}
                  className="font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  Select all
                </button>
              </div>

              {confirmDestructive && !isApplying && (
                <div
                  role="alert"
                  data-testid="plan-destructive-confirm"
                  className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3"
                >
                  <p className="flex items-start gap-2 text-sm font-medium text-red-300">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {destructiveCount} destructive change
                    {destructiveCount === 1 ? "" : "s"} selected
                  </p>
                  <p className="mt-1 pl-6 text-xs leading-relaxed text-red-200/80">
                    Deletions and website-wide rewrites cannot be undone by a
                    single Undo. Confirm to apply them anyway.
                  </p>
                  <div className="mt-2 flex items-center gap-2 pl-6">
                    <button
                      type="button"
                      data-testid="plan-confirm-destructive"
                      onClick={() => {
                        setConfirmDestructive(false);
                        setPendingApplyAll(false);
                        void applyPlan(
                          pendingApplyAll ? null : selectedOperationIds,
                          { allowDestructive: true },
                        );
                      }}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-medium text-white transition-all hover:bg-red-500 active:scale-95"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Confirm &amp; Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDestructive(false);
                        setPendingApplyAll(false);
                      }}
                      className="flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="plan-apply-all"
                  onClick={() => handleApply(true)}
                  disabled={isApplying || ops.length === 0}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isApplying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {isApplying ? "Applying..." : `Apply All (${ops.length})`}
                </button>
                <button
                  type="button"
                  data-testid="plan-apply-selected"
                  onClick={() => handleApply(false)}
                  disabled={isApplying || selectedOps.length === 0}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] text-sm font-medium text-accent transition-all duration-200 hover:bg-accent/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isApplying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {isApplying
                    ? "Applying..."
                    : `Apply Selected (${selectedOps.length})`}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={rejectPlan}
                  disabled={isApplying}
                  data-testid="plan-reject"
                  className="text-xs font-medium text-red-400 transition-colors hover:text-red-300 disabled:opacity-40"
                >
                  Reject plan
                </button>
                <button
                  type="button"
                  onClick={() => regenerate()}
                  disabled={isApplying || !plan}
                  data-testid="plan-regenerate-again"
                  className="flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-hover disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

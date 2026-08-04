// ---------------------------------------------------------------------------
// ReadinessScore — transparent 0–100 website readiness (Phase N, spec §12)
//
// Deterministic rule-based score derived from real project state. Shows
// exactly why points were earned or are missing. Never claims business
// performance. Pure — scoring creates no history and no autosave.
// ---------------------------------------------------------------------------

"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Gauge, TrendingUp, Sparkles } from "lucide-react";
import { useGuidedBuilder } from "../hooks/useGuidedBuilder";

export function ReadinessScore() {
  const { readiness } = useGuidedBuilder();
  const [collapsed, setCollapsed] = useState(false);

  const tone = useMemo(() => {
    if (readiness.score >= 75) return "text-emerald-400";
    if (readiness.score >= 50) return "text-amber-400";
    return "text-text-primary";
  }, [readiness.score]);

  return (
    <div
      data-testid="readiness-score"
      className="border-b border-border/60 px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            Website readiness
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`text-sm font-bold ${tone}`}>{readiness.score}%</span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-text-dim transition-transform duration-200 ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
        </span>
      </button>

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-2">
          {/* Progress bar */}
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-base"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={readiness.score}
            aria-label={`Website readiness ${readiness.score} percent`}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${
                readiness.score >= 75
                  ? "bg-emerald-400"
                  : readiness.score >= 50
                    ? "bg-amber-400"
                    : "bg-accent"
              }`}
              style={{ width: `${readiness.score}%` }}
            />
          </div>

          {/* Strong */}
          {readiness.strong.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400/80">
                <TrendingUp className="h-3 w-3" />
                Strong
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {readiness.strong.slice(0, 4).map((note, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-text-muted"
                  >
                    <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-emerald-400/70" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Could improve */}
          {readiness.couldImprove.length > 0 && (
            <div>
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-400/80">
                <Sparkles className="h-3 w-3" />
                Could improve
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {readiness.couldImprove.slice(0, 4).map((note, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11px] text-text-muted"
                  >
                    <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-amber-400/70" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Category breakdown (collapsible detail) */}
          <details className="group">
            <summary className="cursor-pointer select-none text-[11px] font-medium text-text-dim transition-colors hover:text-text-primary">
              Where points come from
            </summary>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {readiness.categories.map((cat) => {
                const pct =
                  cat.pointsPossible === 0
                    ? 0
                    : Math.round((cat.pointsEarned / cat.pointsPossible) * 100);
                return (
                  <div key={cat.id} className="flex items-center gap-2">
                    <span className="w-28 flex-shrink-0 truncate text-[10px] text-text-muted">
                      {cat.label}
                    </span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-base">
                      <div
                        className="h-full rounded-full bg-accent/70 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 flex-shrink-0 text-right text-[10px] tabular-nums text-text-dim">
                      {cat.pointsEarned}/{cat.pointsPossible}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

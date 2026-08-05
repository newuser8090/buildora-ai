"use client";

// ---------------------------------------------------------------------------
// ImportWarningsPanel — grouped findings for the Review step.
// Groups use headings, friendly explanations first, technical detail behind
// an expandable "Advanced" section, and source location when available.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  ShieldAlert,
  TriangleAlert,
  Scale,
  ImageOff,
  Info,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/utils/cn";
import {
  groupWarnings,
  type WarningGroup,
  type WarningGrouping,
} from "../services/warning-grouping";
import type { CodeImportAnalysis } from "../types";
import type { ConversionReport } from "../conversion/conversion-report";

const GROUP_ICONS: Record<WarningGroup["id"], typeof Info> = {
  removed: ShieldAlert,
  unsupported: TriangleAlert,
  approximated: Scale,
  assets: ImageOff,
  attention: Info,
};

export function ImportWarningsPanel({
  report,
  analysis,
}: {
  report: ConversionReport;
  analysis?: CodeImportAnalysis | null;
}) {
  const grouping: WarningGrouping = groupWarnings({ report, analysis });
  const [openGroup, setOpenGroup] = useState<string | null>(
    grouping.groups.find((g) => g.items.length > 0)?.id ?? null,
  );

  const visible = grouping.groups.filter((g) => g.items.length > 0);

  if (visible.length === 0) {
    return (
      <div
        data-testid="import-warnings-empty"
        className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-300"
      >
        Everything was understood — nothing needed to be removed or changed.
      </div>
    );
  }

  return (
    <div data-testid="import-warnings-panel" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-dim">
        What changed during import
      </h3>
      {visible.map((group) => {
        const Icon = GROUP_ICONS[group.id];
        const open = openGroup === group.id;
        return (
          <div
            key={group.id}
            data-testid={`warning-group-${group.id}`}
            className="overflow-hidden rounded-xl border border-border bg-secondary"
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenGroup(open ? null : group.id)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-card/60"
            >
              <Icon className="h-3.5 w-3.5 flex-none text-text-dim" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-text-primary">
                  {group.label}
                </span>
                <span className="block truncate text-[11px] text-text-muted">
                  {group.description}
                </span>
              </span>
              <span className="rounded-full bg-card px-1.5 py-0.5 text-[10px] font-semibold text-text-dim">
                {group.items.length}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 flex-none text-text-dim transition-transform duration-150",
                  open && "rotate-180",
                )}
              />
            </button>

            {open && (
              <div className="border-t border-border/60 px-3 py-2">
                {group.items.map((item, index) => (
                  <GroupItem key={`${item.code}-${index}`} item={item} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GroupItem({ item }: { item: WarningGroup["items"][number] }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <div
      data-testid="warning-item"
      className="border-b border-border/40 py-2 last:border-b-0"
    >
      <p className="text-xs leading-relaxed text-text-primary">{item.friendly}</p>
      {item.sourceLocation && (
        <p className="mt-0.5 text-[10px] text-text-dim/70">
          Line {item.sourceLocation.startLine}
          {item.sourceLocation.startColumn ? `, column ${item.sourceLocation.startColumn}` : ""}
          {item.path ? ` · ${item.path}` : ""}
        </p>
      )}
      <button
        type="button"
        aria-expanded={showAdvanced}
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mt-1 text-[10px] font-medium text-accent hover:underline"
      >
        {showAdvanced ? "Hide advanced" : "Show advanced"}
      </button>
      {showAdvanced && (
        <pre className="mt-1 overflow-x-auto rounded-lg bg-base p-2 text-[10px] leading-relaxed text-text-muted">
          [{item.code}] {item.message}
        </pre>
      )}
    </div>
  );
}

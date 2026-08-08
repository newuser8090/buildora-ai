"use client";

import { Wand2 } from "lucide-react";
import {
  ELEMENT_QUICK_ACTIONS,
  SECTION_QUICK_ACTIONS,
  PAGE_QUICK_ACTIONS,
} from "../constants";

interface QuickActionsProps {
  /** Selected editable element (text field). */
  elementLabel?: string | null;
  /** Selected section type, e.g. "hero". */
  sectionType?: string | null;
  /** True when a page scope is available. */
  hasPage: boolean;
  busy: boolean;
  onElementAction: (action: { label: string; instruction: string }) => void;
  onSectionAction: (action: { label: string; instruction: string }) => void;
  onPageAction: (action: { label: string; instruction: string }) => void;
}

export function QuickActions({
  elementLabel,
  sectionType,
  hasPage,
  busy,
  onElementAction,
  onSectionAction,
  onPageAction,
}: QuickActionsProps) {
  let actions: Array<{ id: string; label: string; instruction: string; run: () => void }> = [];

  if (elementLabel) {
    actions = ELEMENT_QUICK_ACTIONS.map((action) => ({
      ...action,
      run: () => onElementAction(action),
    }));
  } else if (sectionType) {
    actions = SECTION_QUICK_ACTIONS.map((action) => ({
      ...action,
      run: () => onSectionAction(action),
    }));
  } else if (hasPage) {
    actions = PAGE_QUICK_ACTIONS.filter((a) => a.instruction).map((action) => ({
      ...action,
      run: () => onPageAction(action),
    }));
  }

  if (actions.length === 0) return null;

  const title = elementLabel
    ? "Quick edits for the selected text"
    : sectionType
      ? "Quick edits for this section"
      : "Quick edits for this page";

  return (
    <div className="mb-3" data-testid="copilot-quick-actions">
      <p className="mb-1.5 flex items-center gap-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-dim/70">
        <Wand2 className="h-3 w-3" />
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={`copilot-quick-${action.id}`}
            onClick={action.run}
            disabled={busy}
            className="rounded-full border border-border bg-base px-2.5 py-1 text-[11px] font-medium text-text-muted transition-all duration-150 hover:border-accent/30 hover:bg-accent/[0.04] hover:text-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

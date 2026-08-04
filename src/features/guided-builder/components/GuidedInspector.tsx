// ---------------------------------------------------------------------------
// GuidedInspector — simplified property controls (Phase N, spec §13)
//
// Guided mode replaces technical controls with friendly ones:
//   - "Spacing: Compact / Comfortable / Spacious"  → styles.padding
//   - friendly labels for the most important text fields
//   - "More options" expands the full standard inspector (Standard/Advanced
//     controls always remain reachable)
//
// Changing a simple control creates exactly one history entry (same
// edit-session pattern the standard inspectors use). No duplicate style
// system — it writes the existing `styles.padding` key.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, createElement, useMemo } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { inspectorRegistry } from "@/features/editor/registry/inspector-registry";
import { getGuidedSectionExplanation } from "../registry/guided-section-language";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Quick fields per section type — plain-language labels only
// ---------------------------------------------------------------------------

interface QuickField {
  path: string;
  label: string;
  multiline?: boolean;
}

const QUICK_FIELDS: Record<string, QuickField[]> = {
  hero: [
    { path: "headline", label: "Main message", multiline: true },
    { path: "subheadline", label: "Supporting text", multiline: true },
    { path: "primaryCta.text", label: "Action button text" },
  ],
  header: [
    { path: "logoText", label: "Your name or logo" },
    { path: "ctaText", label: "Action button text" },
  ],
  features: [{ path: "title", label: "Section title" }],
  pricing: [{ path: "title", label: "Section title" }],
  faq: [{ path: "title", label: "Section title" }],
  cta: [
    { path: "headline", label: "Main message", multiline: true },
    { path: "ctaText", label: "Action button text" },
  ],
  footer: [{ path: "text", label: "Bottom text", multiline: true }],
};

const SPACING_PRESETS = [
  { id: "compact", label: "Compact", value: "3rem 0" },
  { id: "comfortable", label: "Comfortable", value: "6rem 0" },
  { id: "spacious", label: "Spacious", value: "9rem 0" },
];

function valueAtPath(props: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let current: unknown = props;
  for (const part of parts) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return "";
    }
  }
  return typeof current === "string" ? current : "";
}

function spacingIdFor(padding: unknown): string {
  if (typeof padding === "string") {
    const found = SPACING_PRESETS.find((p) => p.value === padding);
    if (found) return found.id;
  }
  return "comfortable";
}

// ---------------------------------------------------------------------------
// GuidedInspector
// ---------------------------------------------------------------------------

export interface GuidedInspectorProps {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}

export function GuidedInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: GuidedInspectorProps) {
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const fields = QUICK_FIELDS[section.type] ?? [];
  const spacingId = useMemo(
    () => spacingIdFor(section.styles.padding),
    [section.styles.padding],
  );

  const handleFocus = useCallback(() => {
    beginEditSession();
  }, [beginEditSession]);

  const handleBlur = useCallback(() => {
    commitEditSession();
  }, [commitEditSession]);

  const updateField = useCallback(
    (path: string, next: string) => {
      if (path.includes(".")) {
        const [outer, inner] = path.split(".");
        const current =
          section.props[outer] && typeof section.props[outer] === "object"
            ? (section.props[outer] as Record<string, unknown>)
            : {};
        onUpdateProps({ [outer]: { ...current, [inner]: next } });
        return;
      }
      onUpdateProps({ [path]: next });
    },
    [section.props, onUpdateProps],
  );

  // The standard inspector stays reachable via "More options".
  const InspectorComponent = inspectorRegistry.get(section.type);
  const advanced = InspectorComponent
    ? createElement(InspectorComponent, {
        section,
        onUpdateProps,
        onUpdateStyles,
      })
    : null;

  return (
    <div className="flex flex-col gap-4 px-5 py-4" data-testid="guided-inspector">
      {/* Friendly header — explanation only; the fields carry their own labels */}
      <p className="text-xs leading-relaxed text-text-muted">
        {getGuidedSectionExplanation(section.type)}
      </p>

      {/* Quick text fields — every control has an accessible name */}
      {fields.map((field) => (
        <div key={field.path} className="flex flex-col gap-1.5">
          <label htmlFor={`guided-${section.id}-${field.path}`} className="text-xs font-medium text-text-dim">
            {field.label}
          </label>
          {field.multiline ? (
            <Textarea
              id={`guided-${section.id}-${field.path}`}
              rows={2}
              value={valueAtPath(section.props, field.path)}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={(e) => updateField(field.path, e.target.value)}
            />
          ) : (
            <Input
              id={`guided-${section.id}-${field.path}`}
              value={valueAtPath(section.props, field.path)}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLElement).blur();
              }}
              onChange={(e) => updateField(field.path, e.target.value)}
            />
          )}
        </div>
      ))}

      {/* Spacing — friendly preset mapped to styles.padding */}
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-text-dim">
          Spacing
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {SPACING_PRESETS.map((preset) => {
            const active = spacingId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => onUpdateStyles({ padding: preset.value })}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-200 active:scale-95 ${
                  active
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border/50 bg-card text-text-muted hover:text-text-primary"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Advanced controls remain reachable */}
      {advanced && (
        <details className="group">
          <summary className="cursor-pointer select-none rounded-lg border border-border/40 px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary">
            More options
          </summary>
          <div className="mt-3">{advanced}</div>
        </details>
      )}
    </div>
  );
}

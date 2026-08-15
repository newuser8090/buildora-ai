// ---------------------------------------------------------------------------
// NavigateToPicker — "Navigate to…" page-target picker (Phase P22-E)
//
// A small trigger beside a link href field that lists the project's pages and
// writes the RESOLVED href of the chosen page back into the field. Reuses the
// P22-A typed navigation model (NavTarget → resolveNavTarget → navTargetToHref)
// on top of the existing computePageRoutes table, so the editor and the
// exported site agree on routes by construction.
//
// Design rules (P22-E scope):
//   - WRITES an href string into the existing href property (no persistent
//     NavTarget storage — the full NavTarget-authoring model is P22-G).
//   - Raw href typing remains the fallback (the Input stays editable).
//   - Menu conventions mirror the existing action menus (PageStructurePanel /
//     PageTabs): role=menu, outside click + Escape close, small dropdown.
//
// Phase P22-G — the same file additionally exports NavTargetPicker, the FULL
// typed NavTarget authoring control used by the element interaction editor
// (it stores the typed NavTarget on ElementInteraction). NavigateToPicker
// itself is untouched so P22-E behavior is preserved.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Link2, Trash2 } from "lucide-react";
import { computePageRoutes } from "@/features/routing/routes";
import { navTargetToHref } from "@/features/elements/navigation/resolve";
import type { NavTarget } from "@/features/elements/navigation/types";
import { isSafeNavUrl } from "@/features/elements/navigation/resolve";
import type { Page } from "@/types/project";

export interface NavigateToPickerProps {
  /** Project pages to list as targets. */
  pages: Page[];
  /** Current href value of the field being edited. */
  value: string;
  /** Called with the resolved href when a page is chosen. */
  onChange: (href: string) => void;
  disabled?: boolean;
}

/** Normalize an href for matching against page routes (drop query/hash). */
function routeFromHref(href: string): string {
  const withoutSuffix = href.split(/[?#]/)[0] ?? "";
  return withoutSuffix.replace(/\/+$/, "") || "/";
}

// ---------------------------------------------------------------------------
// NavTargetPicker (Phase P22-G) — full typed NavTarget authoring
//
// Authors one of the P22-A NavTarget kinds (page / section / external /
// email / phone / back). Every change emits a COMPLETE typed NavTarget that
// already passes the shared schema surface (invalid/incomplete configurations
// are not emitted — the caller keeps its previous value). Resolution and URL
// safety reuse resolveNavTarget / navTargetToHref / isSafeNavUrl — nothing is
// re-parsed here.
// ---------------------------------------------------------------------------

export interface NavTargetPickerProps {
  pages: Page[];
  value: NavTarget | null;
  onChange: (target: NavTarget) => void;
  onClear?: () => void;
  disabled?: boolean;
}

const TARGET_KINDS: Array<{ value: NavTarget["kind"]; label: string }> = [
  { value: "page", label: "Page" },
  { value: "section", label: "Section" },
  { value: "external", label: "External URL" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "back", label: "Back" },
];

function CompactSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  dataTestId,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  dataTestId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-text-muted">
      <span className="w-14 shrink-0">{label}</span>
      <select
        value={value}
        disabled={disabled}
        data-testid={dataTestId}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompactTextInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  dataTestId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  dataTestId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-text-muted">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={dataTestId}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-card/60 px-2 text-xs text-text-primary transition-colors focus:border-accent/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

/** Resolve a target for display; unresolved targets show a hint (not emitted). */
function displayHref(target: NavTarget, pages: Page[]): string {
  const href = navTargetToHref(target, pages);
  return href === "#" ? "(unresolved)" : href;
}

export function NavTargetPicker({
  pages,
  value,
  onChange,
  onClear,
  disabled = false,
}: NavTargetPickerProps) {
  const kind = value?.kind ?? "page";

  const sectionTargets = useMemo(() => {
    return pages.flatMap((page) =>
      page.sections.map((section) => ({
        value: section.id,
        label: `${page.title} → ${section.type}`,
        pageId: page.id,
      })),
    );
  }, [pages]);

  const setKind = (nextKind: NavTarget["kind"]) => {
    switch (nextKind) {
      case "page": {
        const first = pages[0];
        if (first) onChange({ kind: "page", pageId: first.id });
        break;
      }
      case "section": {
        const firstSection = sectionTargets[0];
        if (firstSection) {
          onChange({
            kind: "section",
            pageId: firstSection.pageId,
            sectionId: firstSection.value,
          });
        }
        break;
      }
      case "external":
        onChange({ kind: "external", url: "https://" });
        break;
      case "email":
        onChange({ kind: "email", to: "" });
        break;
      case "phone":
        onChange({ kind: "phone", number: "" });
        break;
      case "back":
        onChange({ kind: "back" });
        break;
    }
  };

  const safeExternal =
    kind !== "external" ||
    (value?.kind === "external" && value.url.trim().length > 0 && isSafeNavUrl(value.url));

  return (
    <div
      data-testid="nav-target-picker"
      className="space-y-1.5 rounded-lg border border-border bg-card/30 p-2"
    >
      <CompactSelect
        label="Type"
        value={kind}
        disabled={disabled}
        dataTestId="nav-target-kind"
        options={TARGET_KINDS.map((t) => ({ value: t.value, label: t.label }))}
        onChange={(kind) => setKind(kind as NavTarget["kind"])}
      />

      {kind === "page" && value?.kind === "page" && (
        <CompactSelect
          label="Page"
          value={value.pageId}
          disabled={disabled}
          dataTestId="nav-target-page"
          options={pages.map((page) => ({ value: page.id, label: page.title }))}
          onChange={(pageId) => onChange({ kind: "page", pageId })}
        />
      )}

      {kind === "section" && value?.kind === "section" && (
        <CompactSelect
          label="Section"
          value={value.sectionId}
          disabled={disabled}
          dataTestId="nav-target-section"
          options={sectionTargets.map((t) => ({ value: t.value, label: t.label }))}
          onChange={(sectionId) => {
            const target = sectionTargets.find((t) => t.value === sectionId);
            onChange({
              kind: "section",
              pageId: target?.pageId ?? value.pageId,
              sectionId,
            });
          }}
        />
      )}

      {kind === "external" && value?.kind === "external" && (
        <CompactTextInput
          label="URL"
          value={value.url}
          disabled={disabled}
          dataTestId="nav-target-url"
          placeholder="https://…"
          onChange={(url) => onChange({ kind: "external", url })}
        />
      )}

      {kind === "email" && value?.kind === "email" && (
        <CompactTextInput
          label="To"
          value={value.to}
          disabled={disabled}
          dataTestId="nav-target-email"
          placeholder="you@example.com"
          onChange={(to) => onChange({ kind: "email", to })}
        />
      )}

      {kind === "phone" && value?.kind === "phone" && (
        <CompactTextInput
          label="Number"
          value={value.number}
          disabled={disabled}
          dataTestId="nav-target-phone"
          placeholder="+1 555 0100"
          onChange={(number) => onChange({ kind: "phone", number })}
        />
      )}

      {kind === "back" && (
        <p className="text-[11px] leading-tight text-text-dim">
          Goes back one step in the browser history.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
        <span
          data-testid="nav-target-href"
          className="truncate text-[11px] text-text-dim"
          title="Resolved destination"
        >
          {value ? displayHref(value, pages) : "—"}
          {!safeExternal ? "  (unsafe URL)" : ""}
        </span>
        {onClear && (
          <button
            type="button"
            data-testid="nav-target-clear"
            title="Remove this interaction"
            disabled={disabled}
            onClick={onClear}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-text-dim transition-colors hover:bg-card hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export function NavigateToPicker({
  pages,
  value,
  onChange,
  disabled = false,
}: NavigateToPickerProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const routes = useMemo(() => computePageRoutes(pages), [pages]);

  // The currently selected page (matching the field's href), if any.
  const currentRoute = routeFromHref(value);

  // Close on outside click / Escape (same convention as existing menus).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSelect = useCallback(
    (pageId: string) => {
      // Resolve the page through the typed NavTarget model (homepage = "/").
      const href = navTargetToHref({ kind: "page", pageId }, pages);
      onChange(href);
      setOpen(false);
    },
    [pages, onChange],
  );

  const toggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        type="button"
        data-testid="navigate-to-picker"
        aria-label="Navigate to a page"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-text-dim transition-colors hover:border-accent/30 hover:bg-card hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        title="Navigate to a page"
      >
        <Link2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Page…</span>
      </button>

      {open && (
        <div
          role="menu"
          data-testid="navigate-to-menu"
          className="absolute right-0 top-8 z-40 w-52 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-elevated"
        >
          <div className="border-b border-border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim/60">
            Navigate to page
          </div>
          {routes.map((route) => {
            const selected = route.routeUrl === currentRoute;
            return (
              <button
                key={route.page.id}
                type="button"
                role="menuitem"
                data-testid={`navigate-to-page-${route.page.id}`}
                aria-current={selected || undefined}
                onClick={() => handleSelect(route.page.id)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-base hover:text-text-primary"
              >
                <span
                  className={`min-w-0 flex-1 truncate ${
                    selected ? "text-accent" : "text-text-muted"
                  }`}
                >
                  {route.page.title}
                </span>
                <span className="shrink-0 text-[11px] text-text-dim">
                  {route.routeUrl}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

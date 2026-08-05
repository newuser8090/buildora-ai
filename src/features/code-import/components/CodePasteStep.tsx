"use client";

// ---------------------------------------------------------------------------
// CodePasteStep — Step 1 of the Import Studio.
// Paste code → review limits → analyse. Nothing is run, nothing is sent.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Eraser, Wand2, Lock } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { MAX_SOURCE_SIZE_BYTES } from "../constants";
import { useCodeImportStore } from "../store/code-import-store";
import { useCodeImport } from "../hooks/useCodeImport";
import type { ImportedCodeLanguage } from "../types";

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Detect automatically" },
  { value: "html", label: "HTML" },
  { value: "jsx", label: "JSX / React" },
  { value: "tsx", label: "TSX" },
  { value: "css", label: "CSS" },
];

const EXAMPLE_SOURCE = `<div class="hero">
  <h1>Welcome to your new design</h1>
  <p class="subtitle">Paste something you made or found, and Buildora turns the parts it understands into editable building blocks.</p>
  <button class="cta">Get Started</button>
</div>`;

function byteLength(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function CodePasteStep() {
  const source = useCodeImportStore((s) => s.source);
  const setSource = useCodeImportStore((s) => s.setSource);
  const languageHint = useCodeImportStore((s) => s.languageHint);
  const setLanguageHint = useCodeImportStore((s) => s.setLanguageHint);
  const status = useCodeImportStore((s) => s.status);
  const { analyse } = useCodeImport();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);

  const bytes = useMemo(() => byteLength(source), [source]);
  const tooLarge = bytes > MAX_SOURCE_SIZE_BYTES;
  const empty = source.trim().length === 0;
  const analysing = status === "analysing";
  const canAnalyse = !empty && !tooLarge && !analysing;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleAnalyse = useCallback(() => {
    if (!canAnalyse) return;
    setError(null);
    analyse(source, languageHint);
  }, [canAnalyse, source, languageHint, analyse]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleAnalyse();
      }
    },
    [handleAnalyse],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Source */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="code-import-source"
            className="text-sm font-semibold text-text-primary"
          >
            Paste your code
          </label>
          <span
            data-testid="source-size"
            className={cn(
              "text-[11px] tabular-nums",
              tooLarge ? "font-semibold text-red-400" : "text-text-dim",
            )}
          >
            {formatBytes(bytes)} / {formatBytes(MAX_SOURCE_SIZE_BYTES)}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          id="code-import-source"
          data-testid="code-import-source"
          value={source}
          onChange={(e) => {
            const next = e.target.value;
            setSource(next);
            // Surface the size limit as the user types — the Analyse button
            // is disabled for oversized source, so the reason must be visible.
            if (byteLength(next) > MAX_SOURCE_SIZE_BYTES) {
              setError(
                `This code is ${formatBytes(byteLength(next))} — the limit is ${formatBytes(MAX_SOURCE_SIZE_BYTES)}.`,
              );
            } else {
              setError(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Paste HTML, JSX, React or Tailwind code here…"
          spellCheck={false}
          aria-describedby="code-import-hint"
          className="h-56 w-full resize-none rounded-xl border border-border bg-base p-3 font-mono text-xs leading-relaxed text-text-primary placeholder:text-text-dim/50 transition-all duration-200 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
        />
        <p id="code-import-hint" className="text-[11px] leading-relaxed text-text-dim">
          <Lock className="mr-1 inline h-3 w-3 text-text-dim/70" aria-hidden="true" />
          Your code is read in your browser only. It is never executed, and the
          original code is not saved.
        </p>
      </div>

      {/* Language + actions */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select
            label="Code language"
            value={languageHint ?? ""}
            options={LANGUAGE_OPTIONS}
            onChange={(e) => {
              const value = e.target.value as ImportedCodeLanguage | "";
              setLanguageHint(value === "" ? null : value);
            }}
          />
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="code-import-example"
            onClick={() => {
              setSource(EXAMPLE_SOURCE);
              setLanguageHint(null);
              setError(null);
              textareaRef.current?.focus();
            }}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Use an example
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="code-import-clear"
            disabled={empty}
            onClick={() => {
              setSource("");
              setError(null);
            }}
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear
          </Button>
          <Button
            type="button"
            size="md"
            data-testid="code-import-analyse"
            disabled={!canAnalyse}
            isLoading={analysing}
            onClick={handleAnalyse}
          >
            <ClipboardPaste className="h-4 w-4" />
            Analyse
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" data-testid="code-import-error" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-border/60 bg-secondary px-3 py-2 text-[11px] leading-relaxed text-text-dim">
        <strong className="font-semibold text-text-muted">Supported:</strong>{" "}
        HTML, JSX, TSX, React and Tailwind. Buildora understands headings, text,
        buttons, images, cards, pricing, navigation and more. Things that need
        running code become safe, editable placeholders.
      </div>
    </div>
  );
}

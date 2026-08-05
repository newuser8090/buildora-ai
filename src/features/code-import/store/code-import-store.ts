// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — Import Studio store
//
// Transient UI state ONLY:
//   - never persisted inside the Project
//   - never part of history/undo
//   - no autosave before insertion
//   - reset on dialog close
//   - stale async result protection via requestToken
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { CodeImportAnalysis, ImportedCodeLanguage } from "../types";
import type { ConversionSuccess } from "../conversion/converter-orchestrator";
import type { ConversionError } from "../conversion/conversion-errors";
import type { ImportPlacement } from "../services/insert-imported-block-tree";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportStep = "paste" | "analyse" | "review" | "place" | "success";
export type ImportStatus = "idle" | "analysing" | "ready" | "inserting" | "success" | "error";
export type ConversionMode = "everything" | "supported-only";

export interface ImportInsertionTarget {
  pageId: string;
  sectionId?: string;
  parentBlockId?: string;
}

export interface CodeImportState {
  // ---- Dialog ----
  open: boolean;
  /** Where the import should be inserted (from the opening entry point). */
  insertionTarget: ImportInsertionTarget | null;

  // ---- Step flow ----
  step: ImportStep;
  status: ImportStatus;

  // ---- Source ----
  source: string;
  languageHint: ImportedCodeLanguage | null;

  // ---- Analysis / conversion (transient) ----
  analysis: CodeImportAnalysis | null;
  conversion: ConversionSuccess | null;
  conversionError: ConversionError | null;

  // ---- Review ----
  selectedPreviewBlockId: string | null;
  conversionMode: ConversionMode;

  // ---- Placement ----
  placement: ImportPlacement | null;

  // ---- Feedback ----
  error: string | null;

  // ---- Stale-result guard ----
  requestToken: number;

  // ---- Actions ----
  openDialog: (target?: ImportInsertionTarget | null) => void;
  closeDialog: () => void;
  reset: () => void;

  setSource: (source: string) => void;
  setLanguageHint: (hint: ImportedCodeLanguage | null) => void;
  setStep: (step: ImportStep) => void;

  /** Start analysis; returns the request token for stale-result guarding. */
  beginAnalysis: () => number;
  /** Finish analysis. Ignored when the token is stale. */
  completeAnalysis: (
    token: number,
    analysis: CodeImportAnalysis,
    conversion: ConversionSuccess | null,
    conversionError: ConversionError | null,
  ) => void;

  setSelectedPreviewBlock: (id: string | null) => void;
  setConversionMode: (mode: ConversionMode) => void;
  setPlacement: (placement: ImportPlacement) => void;

  /** Begin insertion (repeated calls are blocked). */
  beginInsert: () => boolean;
  completeInsert: () => void;
  failInsert: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE = {
  open: false,
  insertionTarget: null,
  step: "paste" as const,
  status: "idle" as const,
  source: "",
  languageHint: null,
  analysis: null,
  conversion: null,
  conversionError: null,
  selectedPreviewBlockId: null,
  conversionMode: "everything" as const,
  placement: null,
  error: null,
  requestToken: 0,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCodeImportStore = create<CodeImportState>()((set, get) => ({
  ...INITIAL_STATE,

  openDialog: (target) =>
    set({
      ...INITIAL_STATE,
      open: true,
      insertionTarget: target ?? null,
      step: "paste",
      status: "idle",
    }),

  closeDialog: () => set({ ...INITIAL_STATE }),

  reset: () => set({ ...INITIAL_STATE }),

  setSource: (source) => set({ source }),

  setLanguageHint: (hint) => set({ languageHint: hint }),

  setStep: (step) => set({ step }),

  beginAnalysis: () => {
    const token = get().requestToken + 1;
    set({
      requestToken: token,
      status: "analysing",
      step: "analyse",
      analysis: null,
      conversion: null,
      conversionError: null,
      error: null,
      selectedPreviewBlockId: null,
    });
    return token;
  },

  completeAnalysis: (token, analysis, conversion, conversionError) => {
    // Stale async result protection — ignore out-of-order completions.
    if (token !== get().requestToken) return;
    set({
      analysis,
      conversion,
      conversionError,
      // The Analyse step is the friendly summary screen: it shows what was
      // found (success) or why conversion stopped (error). The user then
      // proceeds to Review via the explicit "Review and place" action.
      status: conversion ? "ready" : "error",
      step: "analyse",
      error: conversionError ? userSafeErrorMessage(conversionError) : null,
      selectedPreviewBlockId: null,
    });
  },

  setSelectedPreviewBlock: (id) => set({ selectedPreviewBlockId: id }),

  setConversionMode: (mode) => set({ conversionMode: mode }),

  setPlacement: (placement) => set({ placement }),

  beginInsert: () => {
    const { status } = get();
    if (status !== "ready") return false;
    set({ status: "inserting", error: null });
    return true;
  },

  completeInsert: () => {
    set({ status: "success", step: "success" });
  },

  failInsert: (message) => {
    set({ status: "error", error: message });
  },
}));

/** User-safe error copy for the dialog. */
function userSafeErrorMessage(error: ConversionError): string {
  switch (error.code) {
    case "CONVERSION_NOT_ALLOWED":
      return "We couldn't safely read this code. Check that it is HTML, JSX, or React code and try again.";
    case "NO_CONVERTIBLE_CONTENT":
      return "Nothing editable was found in that code. Try pasting a different part.";
    case "INVALID_OUTPUT_TREE":
      return "This code produced a design Buildora couldn't keep safe. Try simplifying it.";
    default:
      return "Something went wrong while reading the code. Please try again.";
  }
}

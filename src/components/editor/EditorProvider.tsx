"use client";

import { type ReactNode } from "react";
import { useRegisterDefaultSections } from "@/features/editor/registry/register-default-sections";
import { useRegisterDefaultInspectors } from "@/features/editor/registry/register-default-inspectors";
import { useRegisterDefaultSectionLibrary } from "@/features/editor/section-library/registry/use-register-default-section-library";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBeforeUnload } from "@/hooks/useBeforeUnload";
import { useProjectController } from "@/features/persistence/hooks/useProjectController";
import { useGuidedBuilderInit } from "@/features/guided-builder/hooks/useGuidedBuilderInit";

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  // Register sections + inspectors + section library
  useRegisterDefaultSections();
  useRegisterDefaultInspectors();
  useRegisterDefaultSectionLibrary();

  // Keyboard shortcuts (including Ctrl+S/Cmd+S)
  useKeyboardShortcuts();

  // Initialize persistence controller (singleton, runs once)
  useProjectController();

  // Phase N: sync guided-builder prefs (experience mode etc.) after mount
  useGuidedBuilderInit();

  // beforeunload protection when dirty
  useBeforeUnload();

  return <>{children}</>;
}

"use client";

import { type ReactNode } from "react";
import { useRegisterDefaultSections } from "@/features/editor/registry/register-default-sections";
import { useRegisterDefaultInspectors } from "@/features/editor/registry/register-default-inspectors";
import { useRegisterDefaultSectionLibrary } from "@/features/editor/section-library/registry/use-register-default-section-library";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBeforeUnload } from "@/hooks/useBeforeUnload";
import { useProjectController } from "@/features/persistence/hooks/useProjectController";
import { useGuidedBuilderInit } from "@/features/guided-builder/hooks/useGuidedBuilderInit";
import { useRegisterDefaultBlocks } from "@/features/blocks/registry/use-register-default-blocks";
import { useBlockEditorInit } from "@/features/blocks/hooks/useBlockEditorInit";

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  // Register sections + inspectors + section library
  useRegisterDefaultSections();
  useRegisterDefaultInspectors();
  useRegisterDefaultSectionLibrary();

  // Phase O: register the LEGO block catalogue + load block builder prefs
  useRegisterDefaultBlocks();
  useBlockEditorInit();

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

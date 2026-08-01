"use client";

import { type ReactNode } from "react";
import { useRegisterDefaultSections } from "@/features/editor/registry/register-default-sections";
import { useRegisterDefaultInspectors } from "@/features/editor/registry/register-default-inspectors";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useBeforeUnload } from "@/hooks/useBeforeUnload";
import { useProjectController } from "@/features/persistence/hooks/useProjectController";

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  // Register sections + inspectors
  useRegisterDefaultSections();
  useRegisterDefaultInspectors();

  // Keyboard shortcuts (including Ctrl+S/Cmd+S)
  useKeyboardShortcuts();

  // Initialize persistence controller (singleton, runs once)
  useProjectController();

  // beforeunload protection when dirty
  useBeforeUnload();

  return <>{children}</>;
}

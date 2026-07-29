"use client";

import { type ReactNode } from "react";
import { useRegisterDefaultSections } from "@/features/editor/registry/register-default-sections";
import { useRegisterDefaultInspectors } from "@/features/editor/registry/register-default-inspectors";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

interface EditorProviderProps {
  children: ReactNode;
}

export function EditorProvider({ children }: EditorProviderProps) {
  // Register sections + inspectors
  useRegisterDefaultSections();
  useRegisterDefaultInspectors();

  // Keyboard shortcuts
  useKeyboardShortcuts();

  return <>{children}</>;
}

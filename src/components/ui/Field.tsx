"use client";

import { type ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface FieldProps {
  label?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span className="text-xs font-medium text-text-dim">{label}</span>
      )}
      {children}
    </div>
  );
}

/** Horizontal label + control row. */
export function FieldRow({
  label,
  children,
  className,
}: FieldProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        className,
      )}
    >
      {label && (
        <span className="text-xs font-medium text-text-dim">{label}</span>
      )}
      {children}
    </div>
  );
}

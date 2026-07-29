"use client";

import { cn } from "@/utils/cn";

export interface SwitchProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}

export function Switch({ label, checked, onChange, id }: SwitchProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      {label && (
        <span className="text-xs font-medium text-text-dim">{label}</span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={id}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-accent" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200",
            checked && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

import { type ReactNode } from "react";
import { cn } from "@/utils/cn";

export type LayoutProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Neutral layout shell — background/text styling is handled by globals.css.
 * This component only provides the flex column structure.
 */
export function Layout({ children, className }: LayoutProps) {
  return (
    <div className={cn("flex h-dvh flex-col overflow-hidden", className)}>
      {children}
    </div>
  );
}

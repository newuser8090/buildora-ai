import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import type { CardVariant } from "@/types";

// ---------------------------------------------------------------------------
// Style map
// ---------------------------------------------------------------------------

const variantStyles: Record<CardVariant, string> = {
  elevated:
    "bg-white shadow-md shadow-neutral-200/50 dark:bg-neutral-900 dark:shadow-neutral-950/50",
  outlined:
    "border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900",
  flat: "bg-neutral-50 dark:bg-neutral-800/50",
};

// ---------------------------------------------------------------------------
// Card root
// ---------------------------------------------------------------------------

export type CardProps = ComponentPropsWithoutRef<"div"> & {
  variant?: CardVariant;
};

export function Card({
  variant = "elevated",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn("rounded-xl overflow-hidden", variantStyles[variant], className)}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card.Header
// ---------------------------------------------------------------------------

export type CardHeaderProps = ComponentPropsWithoutRef<"div"> & {
  /** Optional action rendered on the right side of the header. */
  action?: ReactNode;
};

export function CardHeader({
  className,
  children,
  action,
  ...rest
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-6 py-4 border-b border-neutral-100 dark:border-neutral-800",
        className,
      )}
      {...rest}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card.Body
// ---------------------------------------------------------------------------

export type CardBodyProps = ComponentPropsWithoutRef<"div">;

export function CardBody({ className, children, ...rest }: CardBodyProps) {
  return (
    <div className={cn("px-6 py-4", className)} {...rest}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card.Footer
// ---------------------------------------------------------------------------

export type CardFooterProps = ComponentPropsWithoutRef<"div">;

export function CardFooter({ className, children, ...rest }: CardFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-6 py-4 border-t border-neutral-100 dark:border-neutral-800",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

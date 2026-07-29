import { forwardRef, type ElementType, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/utils/cn";
import type { ButtonVariant, ComponentSize } from "@/types";

// ---------------------------------------------------------------------------
// Style map
// ---------------------------------------------------------------------------

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-950 disabled:bg-neutral-300 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:active:bg-neutral-50 dark:disabled:bg-neutral-700",
  secondary:
    "bg-neutral-200 text-neutral-900 hover:bg-neutral-300 active:bg-neutral-400 disabled:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700 dark:active:bg-neutral-600 dark:disabled:bg-neutral-900",
  outline:
    "border border-neutral-300 text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200 disabled:border-neutral-200 disabled:text-neutral-400 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:active:bg-neutral-700",
  ghost:
    "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200 disabled:text-neutral-400 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 dark:active:bg-neutral-700",
  danger:
    "bg-red-600 text-white hover:bg-red-500 active:bg-red-700 disabled:bg-red-300",
};

const sizeStyles: Record<ComponentSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-base gap-2.5 rounded-xl",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ButtonProps<TAs extends ElementType = "button"> = {
  variant?: ButtonVariant;
  size?: ComponentSize;
  isLoading?: boolean;
  as?: TAs;
} & ComponentPropsWithoutRef<TAs>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      className,
      disabled,
      children,
      as: Tag = "button",
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <Tag
        ref={ref as never}
        disabled={isDisabled}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 disabled:pointer-events-none",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...rest}
      >
        {isLoading && (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        )}
        {children}
      </Tag>
    );
  },
);

Button.displayName = "Button";

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Polymorphic component props
// ---------------------------------------------------------------------------

/** Makes `as` optional; defaults to a sensible HTML element. */
export type PolymorphicProps<
  TAs extends React.ElementType = "div",
  TProps = object,
> = TProps & {
  as?: TAs;
  children?: ReactNode;
  className?: string;
};

// ---------------------------------------------------------------------------
// Design system tokens
// ---------------------------------------------------------------------------

export type ComponentSize = "sm" | "md" | "lg";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger";

export type CardVariant = "elevated" | "outlined" | "flat";

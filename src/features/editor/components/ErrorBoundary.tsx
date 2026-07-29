"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// ErrorBoundary — catches render errors and shows a friendly message
// Does NOT replace proper validation; acts as the final resilience layer.
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log in development to identify the failing section
    if (process.env.NODE_ENV === "development") {
      console.warn("[Buildora ErrorBoundary] Caught render error:", error.message);
      console.warn("[Buildora ErrorBoundary] Component stack:", errorInfo.componentStack);
    }
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDev = process.env.NODE_ENV === "development";

      return (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            border: "1px dashed #f87171",
            borderRadius: "0.5rem",
            margin: "1rem",
            background: "rgba(248, 113, 113, 0.05)",
          }}
        >
          <p
            style={{
              fontSize: "0.875rem",
              color: "#f87171",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            This section could not be displayed.
          </p>
          {isDev && this.state.error && (
            <details style={{ fontSize: "0.75rem", color: "#94a3b8", textAlign: "left", maxWidth: "400px", margin: "0 auto" }}>
              <summary style={{ cursor: "pointer", marginBottom: "0.5rem" }}>
                Error details (development only)
              </summary>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

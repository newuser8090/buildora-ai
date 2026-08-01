"use client";

import { type ReactNode } from "react";
import { FilesIcon } from "lucide-react";

export interface AssetGridProps {
  children?: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}

export function AssetGrid({ children, isEmpty, emptyMessage }: AssetGridProps) {
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-card/50">
          <FilesIcon className="h-6 w-6 text-text-dim/40" />
        </div>
        <p className="text-sm text-text-muted">
          {emptyMessage || "No assets found."}
        </p>
        <p className="mt-1 text-xs text-text-dim/60">
          Upload images to use them in your sections.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}

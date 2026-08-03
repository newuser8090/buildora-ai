"use client";

import { useRef, useState, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Upload } from "lucide-react";

export interface DragDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export function DragDropZone({ onFilesSelected, disabled }: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items?.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected],
  );

  const handleFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        onFilesSelected(files);
      }
      // Reset so the same file can be selected again
      if (inputRef.current) inputRef.current.value = "";
    },
    [onFilesSelected],
  );

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
      role="button"
      tabIndex={0}
      aria-label="Upload image files"
      className={`relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
        isDragging
          ? "border-accent bg-accent/5"
          : "border-border/50 hover:border-accent/30 hover:bg-card/30"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card/50">
        <Upload className={`h-5 w-5 ${isDragging ? "text-accent" : "text-text-dim"}`} />
      </div>

      <div>
        <p className="text-sm font-medium text-text-muted">
          {isDragging ? "Drop files here" : "Click or drag to upload"}
        </p>
        <p className="mt-1 text-xs text-text-dim/60">
          PNG, JPEG, WebP, or SVG &bull; Max 5 MB per file
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
        onChange={handleFileInput}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

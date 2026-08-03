"use client";

import { useRef, useState, useCallback } from "react";
import { Replace, Loader2, Upload } from "lucide-react";

export interface ReplaceAssetInputProps {
  assetName: string;
  onReplace: (file: File) => Promise<void>;
  onCancel: () => void;
}

export function ReplaceAssetInput({ assetName, onReplace, onCancel }: ReplaceAssetInputProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsProcessing(true);
      setError(null);

      try {
        await onReplace(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Replace failed.");
      } finally {
        setIsProcessing(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onReplace],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Replace className="h-4 w-4 text-text-dim" />
        <p className="text-sm text-text-muted">
          Replace <span className="font-medium text-text-primary">{assetName}</span>
        </p>
      </div>

      {isProcessing ? (
        <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card/30 px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span className="text-sm text-text-muted">Processing replacement...</span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 rounded-xl border-2 border-dashed border-border/50 px-4 py-3 text-sm text-text-muted transition-all duration-200 hover:border-accent/30 hover:bg-card/30"
          >
            <Upload className="h-4 w-4" />
            Select replacement file
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="self-start text-xs text-text-dim/60 transition-colors hover:text-text-dim"
          >
            Cancel
          </button>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}

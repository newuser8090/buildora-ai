"use client";

import { useState, useCallback } from "react";

export interface UseAssetPickerOptions {
  /** Called when an asset is selected */
  onSelect?: (assetId: string, altText?: string) => void;
  /** Called when the selection is cleared */
  onClear?: () => void;
}

export function useAssetPicker(options?: UseAssetPickerOptions) {
  const [isOpen, setIsOpen] = useState(false);

  const openPicker = useCallback(() => setIsOpen(true), []);
  const closePicker = useCallback(() => setIsOpen(false), []);

  const handleSelect = useCallback(
    (assetId: string, altText?: string) => {
      options?.onSelect?.(assetId, altText);
      setIsOpen(false);
    },
    [options],
  );

  const handleClear = useCallback(() => {
    options?.onClear?.();
    setIsOpen(false);
  }, [options]);

  return {
    isOpen,
    openPicker,
    closePicker,
    handleSelect,
    handleClear,
    pickerProps: {
      onSelect: handleSelect,
      onClear: handleClear,
      onClose: closePicker,
    } as const,
  };
}

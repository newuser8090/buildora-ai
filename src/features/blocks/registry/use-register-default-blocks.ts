"use client";

import { useEffect } from "react";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "./block-registry";

/** Register the built-in block catalogue once on mount (idempotent). */
export function useRegisterDefaultBlocks(): void {
  useEffect(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  }, []);
}

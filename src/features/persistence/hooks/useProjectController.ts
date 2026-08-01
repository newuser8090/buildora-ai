"use client";

import { useEffect, useRef } from "react";
import { ProjectController } from "../services/project-controller";
import { IndexedDbProjectAdapter } from "../adapters/indexed-db-adapter";

// ---------------------------------------------------------------------------
// Singleton — one controller per application lifetime
// ---------------------------------------------------------------------------

let controllerInstance: ProjectController | null = null;

function getController(): ProjectController {
  if (!controllerInstance) {
    const adapter = new IndexedDbProjectAdapter();
    controllerInstance = new ProjectController(adapter);
  }
  return controllerInstance;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProjectController(): {
  controller: ProjectController;
} {
  const initialized = useRef(false);

  useEffect(() => {
    const controller = getController();

    if (!initialized.current) {
      initialized.current = true;
      controller.initialize().catch(() => {
        // Error is handled inside controller (sets hydrationError in store)
      });
    }

    return () => {
      // Only shutdown on explicit unmount (e.g., HMR)
      if (typeof window === "undefined") return;
    };
  }, []);

  return { controller: getController() };
}

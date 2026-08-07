// ---------------------------------------------------------------------------
// useDashboardPublishStatuses — publish status per dashboard project (P7)
//
// Derived from deployment history + project revision — never stored in the
// project. Lightweight: reads deployment summaries once per project list
// change. Failures degrade to "unknown" (never block the dashboard).
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState } from "react";
import { DeploymentService } from "../services/deployment-service";
import { getDeploymentAdapter } from "../storage/deployment-adapter";
import type { PublishStatus } from "../types";

export type DashboardPublishStatus = PublishStatus | "unknown";

export function useDashboardPublishStatuses(
  projects: { id: string; revision: number }[],
): Record<string, DashboardPublishStatus> {
  const [statuses, setStatuses] = useState<Record<string, DashboardPublishStatus>>({});

  // Stable key: the caller may rebuild the projects array every render (e.g.
  // page.tsx maps it inline). Keying on id:revision prevents effect churn.
  const projectsKey = projects
    .map((p) => `${p.id}:${p.revision}`)
    .join("|");

  useEffect(() => {
    if (projects.length === 0) return;
    let cancelled = false;
    const service = new DeploymentService(getDeploymentAdapter());

    void (async () => {
      const entries = await Promise.all(
        projects.map(async (p) => {
          try {
            const active = await service.getActiveDeployment(p.id);
            if (!active) return [p.id, "never-published" as DashboardPublishStatus];
            if (p.revision > active.projectRevision) {
              return [p.id, "changes-unpublished" as DashboardPublishStatus];
            }
            return [p.id, "published" as DashboardPublishStatus];
          } catch {
            return [p.id, "unknown" as DashboardPublishStatus];
          }
        }),
      );
      if (cancelled) return;
      setStatuses(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id:revision
  }, [projectsKey]);

  // No projects → nothing to report. The async path keeps the state fresh
  // whenever the id:revision key changes.
  return projects.length === 0 ? {} : statuses;
}

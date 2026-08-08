// ---------------------------------------------------------------------------
// useDashboardPublishStatuses — publish status per dashboard project (P7 + P8)
//
// Derived from deployment history + project revision — never stored in the
// project, and no network calls per card (the live URL comes from locally
// persisted deployment history, not the provider). Failures degrade to
// "unknown" (never block the dashboard).
//
// Status vocabulary (P8): never-published (Draft) / published (files) /
// demo-published / live / changes-unpublished / failed.
// ---------------------------------------------------------------------------

"use client";

import { useEffect, useState } from "react";
import { DeploymentService } from "../services/deployment-service";
import { getDeploymentAdapter } from "../storage/deployment-adapter";

export type DashboardPublishStatus =
  | "never-published"
  | "published"
  | "demo-published"
  | "live"
  | "changes-unpublished"
  | "failed"
  | "unknown";

export interface DashboardPublishInfo {
  status: DashboardPublishStatus;
  /** Public URL when a real provider deployment is live (local history). */
  liveUrl?: string;
  providerId?: string;
}

export function useDashboardPublishStatuses(
  projects: { id: string; revision: number }[],
): Record<string, DashboardPublishInfo> {
  const [infos, setInfos] = useState<Record<string, DashboardPublishInfo>>({});

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
            const all = await service.listDeployments(p.id);
            const active = all
              .filter((d) => d.status === "live")
              .sort((a, b) =>
                (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
                  a.activatedAt ?? a.completedAt ?? a.createdAt,
                ),
              )[0] ?? null;

            if (!active) {
              const failed = all.some(
                (d) => d.status === "failed" || d.status === "cancelled",
              );
              return [
                p.id,
                {
                  status: failed ? ("failed" as const) : ("never-published" as const),
                },
              ];
            }

            if (p.revision > active.projectRevision) {
              return [
                p.id,
                {
                  status: "changes-unpublished" as const,
                  liveUrl: active.productionUrl ?? active.url,
                  providerId: active.providerId,
                },
              ];
            }

            const status: DashboardPublishStatus =
              active.providerId === "vercel"
                ? "live"
                : active.providerId === "mock"
                  ? "demo-published"
                  : "published";
            return [
              p.id,
              {
                status,
                liveUrl:
                  active.productionUrl ??
                  (active.providerId === "vercel" ? active.deploymentUrl : active.url),
                providerId: active.providerId,
              },
            ];
          } catch {
            return [p.id, { status: "unknown" as const }];
          }
        }),
      );
      if (cancelled) return;
      setInfos(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id:revision
  }, [projectsKey]);

  return projects.length === 0 ? {} : infos;
}

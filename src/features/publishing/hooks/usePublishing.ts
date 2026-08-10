// ---------------------------------------------------------------------------
// usePublishing — publish, history, unpublished-changes, and provider-driven
// management (Phase P7 + P8)
//
// Wires the PublishService + DeploymentService to the publishing store.
// Publishing never mutates project content. Rollback/delete/cancel resolve
// the provider from the deployment record (never hard-coded). A client-side
// in-flight lock prevents accidental duplicate production publishes.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getPublishingProvider, getPublishingProviders } from "../providers";
import { PublishService } from "../services/publish-service";
import { DeploymentService } from "../services/deployment-service";
import { getDeploymentAdapter } from "../storage/deployment-adapter";
import {
  claimPublishLock,
  releasePublishLock,
} from "../services/publish-concurrency";
import { usePublishingStore } from "../store/publishing-store";
import { makePublishError } from "../errors";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { canPublishProject } from "@/features/workspaces/permissions/workspace-permissions";
import { recordWorkspaceActivity } from "@/features/workspaces/services/activity-bridge";
import type { ProviderAvailability, PublishServiceResult, PublishStatus } from "../types";

export function usePublishing() {
  const project = useEditorStore((s) => s.project);
  const revision = useEditorStore((s) => s.revision);

  const [publishStatus, setPublishStatus] = useState<PublishStatus>("never-published");
  const [providerAvailability, setProviderAvailability] = useState<
    Record<string, ProviderAvailability>
  >({});

  // Derived services (memoized per project id).
  const services = useMemo(() => {
    const storage = getDeploymentAdapter();
    return {
      publishService: (providerId: string) =>
        new PublishService({ provider: getPublishingProvider(providerId)!, storage }),
      deploymentService: new DeploymentService(storage),
    };
  }, []);

  /** Resolve the provider instance for a deployment record. */
  const providerFor = useCallback((providerId: string) => {
    return getPublishingProvider(providerId);
  }, []);

  const refreshDeployments = useCallback(async () => {
    if (!project.id) return;
    const deployments = await services.deploymentService.listDeployments(project.id);
    usePublishingStore.getState().setDeployments(deployments);
    const status = await services.deploymentService.getPublishStatus(project, revision);
    setPublishStatus(status);
  }, [project, revision, services]);

  // Refresh history + status whenever the project or revision changes.
  useEffect(() => {
    if (!project.id) return;
    let cancelled = false;
    void (async () => {
      const deployments = await services.deploymentService.listDeployments(project.id);
      if (cancelled) return;
      usePublishingStore.getState().setDeployments(deployments);
      const status = await services.deploymentService.getPublishStatus(project, revision);
      if (!cancelled) setPublishStatus(status);
    })();
    return () => {
      cancelled = true;
    };
  }, [project, revision, services]);

  // Load provider availability once per mount (cached server-side + per
  // provider instance). The dialog hides unavailable providers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        getPublishingProviders().map(async (provider) => {
          try {
            const availability = await provider.isAvailable();
            return [provider.id, availability] as const;
          } catch {
            return [provider.id, { available: false } as ProviderAvailability] as const;
          }
        }),
      );
      if (cancelled) return;
      setProviderAvailability(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const publish = useCallback(
    async (providerId: string, signal?: AbortSignal): Promise<PublishServiceResult> => {
      if (!project.id) {
        return { ok: false, error: makePublishError("PROJECT_INVALID", "No project is open.") };
      }

      // Phase P14 — collaboration permission gate (service boundary). A viewer
      // (or a member whose role was revoked while the editor was open) must
      // never publish, even if a stale UI state would have shown the button.
      const accessState = useWorkspaceAccessStore.getState();
      if (accessState.workspaceId) {
        const role = accessState.role ?? "viewer";
        if (!canPublishProject(role)) {
          return {
            ok: false,
            error: makePublishError(
              "PERMISSION_DENIED",
              "Only workspace editors and owners can publish this project.",
            ),
          };
        }
        if (accessState.access.mode !== "editable") {
          return {
            ok: false,
            error: makePublishError(
              "PERMISSION_DENIED",
              "This project is open read-only, so it can't be published right now.",
            ),
          };
        }
      }

      // Client-side concurrency guard: one active publish per project+provider.
      if (!claimPublishLock(project.id, providerId)) {
        // Focus the already-running publish (the progress view is open).
        usePublishingStore.getState().startProgress();
        return {
          ok: false,
          error: makePublishError(
            "DEPLOYMENT_BUSY",
            "This project is already being published. Wait for it to finish, then try again.",
          ),
        };
      }

      try {
        const store = usePublishingStore.getState();
        store.setAttemptedProvider(providerId);
        store.startProgress();
        const service = services.publishService(providerId);
        const result = await service.publish(
          { project, revision, providerId },
          (event) => usePublishingStore.getState().setProgress(event),
          signal,
        );
        usePublishingStore.getState().setResult(result);
        await refreshDeployments();
        // Phase P15 — activity: a successful publish of a workspace project is
        // recorded server-side (actor derived from the session; type + metadata
        // allow-listed). Fire-and-forget — activity never breaks publishing.
        if (result.ok) {
          recordWorkspaceActivity({
            workspaceId: useWorkspaceAccessStore.getState().workspaceId,
            projectId: project.id,
            type: "publish.completed",
            metadata: { provider: providerId, project: project.name },
          });
        }
        return result;
      } finally {
        releasePublishLock(project.id, providerId);
      }
    },
    [project, revision, services, refreshDeployments],
  );

  const rollback = useCallback(
    async (deploymentId: string) => {
      const deployments = usePublishingStore.getState().deployments;
      const record = deployments.find((d) => d.id === deploymentId);
      const provider = providerFor(record?.providerId ?? "mock");
      const result = await services.deploymentService.rollback(
        project.id,
        deploymentId,
        provider?.rollback ? provider.rollback.bind(provider) : undefined,
      );
      if (result.ok) {
        await refreshDeployments();
        // Phase P15 — activity: a rollback is a meaningful shared-project event.
        recordWorkspaceActivity({
          workspaceId: useWorkspaceAccessStore.getState().workspaceId,
          projectId: project.id,
          type: "publish.rollback",
          metadata: { provider: record?.providerId ?? "", project: project.name },
        });
      }
      return result;
    },
    [project.id, project.name, services, refreshDeployments, providerFor],
  );

  const cancelDeployment = useCallback(
    async (deploymentId: string) => {
      const deployments = usePublishingStore.getState().deployments;
      const record = deployments.find((d) => d.id === deploymentId);
      const provider = providerFor(record?.providerId ?? "mock");
      if (!provider?.cancel) {
        return {
          ok: false,
          error: makePublishError("DEPLOYMENT_CANCEL_FAILED", "This publishing option can't cancel a publish in progress."),
        };
      }
      try {
        // Providers manage deployments by THEIR id, never the local id.
        await provider.cancel(
          record?.providerDeploymentId ?? deploymentId,
          project.id,
        );
        await refreshDeployments();
        return { ok: true as const };
      } catch (err) {
        return {
          ok: false as const,
          error:
            err && typeof err === "object" && "code" in err && "message" in err
              ? (err as { code: string; message: string })
              : makePublishError("DEPLOYMENT_CANCEL_FAILED", "The publish couldn't be cancelled."),
        };
      }
    },
    [project.id, refreshDeployments, providerFor],
  );

  const deleteDeployment = useCallback(
    async (deploymentId: string) => {
      const deployments = usePublishingStore.getState().deployments;
      const record = deployments.find((d) => d.id === deploymentId);
      const provider = providerFor(record?.providerId ?? "mock");
      const result = await services.deploymentService.deleteDeployment(
        deploymentId,
        provider?.deleteDeployment ? provider.deleteDeployment.bind(provider) : undefined,
      );
      if (result.ok) await refreshDeployments();
      return result;
    },
    [services, refreshDeployments, providerFor],
  );

  return {
    publish,
    rollback,
    cancelDeployment,
    deleteDeployment,
    refreshDeployments,
    publishStatus,
    providerAvailability,
  };
}



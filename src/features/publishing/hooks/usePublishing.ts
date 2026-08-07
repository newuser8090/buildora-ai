// ---------------------------------------------------------------------------
// usePublishing — publish, history, and unpublished-changes (Phase P7)
//
// Wires the PublishService + DeploymentService to the publishing store.
// Publishing never mutates project content.
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getPublishingProvider } from "../providers";
import { PublishService } from "../services/publish-service";
import { DeploymentService } from "../services/deployment-service";
import { getDeploymentAdapter } from "../storage/deployment-adapter";
import { usePublishingStore } from "../store/publishing-store";
import type { PublishStatus } from "../types";

export function usePublishing() {
  const project = useEditorStore((s) => s.project);
  const revision = useEditorStore((s) => s.revision);
  const view = usePublishingStore((s) => s.view);

  const [publishStatus, setPublishStatus] = useState<PublishStatus>("never-published");

  // Derived services (memoized per project id).
  const services = useMemo(() => {
    const storage = getDeploymentAdapter();
    return {
      publishService: (providerId: string) =>
        new PublishService({ provider: getPublishingProvider(providerId)!, storage }),
      deploymentService: new DeploymentService(storage),
    };
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

  const publish = useCallback(
    async (providerId: string, signal?: AbortSignal) => {
      if (!project.id) return;
      const store = usePublishingStore.getState();
      store.startProgress();
      const service = services.publishService(providerId);
      const result = await service.publish(
        { project, revision, providerId },
        (event) => usePublishingStore.getState().setProgress(event),
        signal,
      );
      usePublishingStore.getState().setResult(result);
      await refreshDeployments();
      return result;
    },
    [project, revision, services, refreshDeployments],
  );

  const rollback = useCallback(
    async (deploymentId: string) => {
      const provider = getPublishingProvider("mock");
      const result = await services.deploymentService.rollback(
        project.id,
        deploymentId,
        provider?.rollback ? provider.rollback.bind(provider) : undefined,
      );
      if (result.ok) await refreshDeployments();
      return result;
    },
    [project.id, services, refreshDeployments],
  );

  const deleteDeployment = useCallback(
    async (deploymentId: string) => {
      const provider = getPublishingProvider("mock");
      const result = await services.deploymentService.deleteDeployment(
        deploymentId,
        provider?.deleteDeployment ? provider.deleteDeployment.bind(provider) : undefined,
      );
      if (result.ok) await refreshDeployments();
      return result;
    },
    [services, refreshDeployments],
  );

  return {
    view,
    publish,
    rollback,
    deleteDeployment,
    refreshDeployments,
    publishStatus,
  };
}

"use client";

// ---------------------------------------------------------------------------
// DeploymentHistory — deployment list + rollback confirmation (Phase P7)
//
// Rollback restores a past deployment (mock: refreshes active status) and
// NEVER touches project editor content. Rollback requires explicit
// confirmation; providers without rollback show an explanation.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { PackageOpen, X } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { usePublishingStore } from "../store/publishing-store";
import { usePublishing } from "../hooks/usePublishing";
import { DeploymentCard } from "./DeploymentCard";
import { DeploymentService } from "../services/deployment-service";
import { getDeploymentAdapter } from "../storage/deployment-adapter";
import type { DeploymentRecord } from "../types";

export function DeploymentHistory() {
  const deployments = usePublishingStore((s) => s.deployments);
  const project = useEditorStore((s) => s.project);
  const { refreshDeployments } = usePublishing();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<DeploymentRecord | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);

  const current = DeploymentService.prototype
    ? findActive(deployments)
    : null;

  const handleConfirmRollback = async () => {
    if (!confirmTarget || rollbackBusy) return;
    setRollbackBusy(true);
    setRollbackError(null);
    try {
      const storage = getDeploymentAdapter();
      const service = new DeploymentService(storage);
      // Mock provider supports rollback; other providers would surface
      // ROLLBACK_UNSUPPORTED through the same path.
      const provider = await import("../providers").then((m) =>
        m.getPublishingProvider(confirmTarget.providerId),
      );
      const result = await service.rollback(
        project.id,
        confirmTarget.id,
        provider?.rollback ? provider.rollback.bind(provider) : undefined,
      );
      if (result.ok) {
        await refreshDeployments();
        setActiveId(result.deployment.id);
        setConfirmTarget(null);
      } else {
        setRollbackError(result.error.message);
      }
    } catch (err) {
      setRollbackError(
        err instanceof Error ? err.message : "Could not restore that version.",
      );
    } finally {
      setRollbackBusy(false);
    }
  };

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <PackageOpen className="h-10 w-10 text-text-dim/40" />
        <p className="text-sm text-text-muted">
          Nothing published yet. Your first publish will appear here.
        </p>
      </div>
    );
  }

  const activeIdFinal = activeId ?? current?.id;
  const inProgress = deployments.filter(
    (d) => d.status === "queued" || d.status === "building" || d.status === "uploading",
  );
  const currentDeployment = deployments.filter((d) => d.status === "live" && d.id === activeIdFinal);
  const previous = deployments.filter((d) => d.status === "live" && d.id !== activeIdFinal);
  const failed = deployments.filter((d) => d.status === "failed" || d.status === "cancelled");

  const renderCard = (deployment: DeploymentRecord) => (
    <DeploymentCard
      key={deployment.id}
      deployment={deployment}
      active={deployment.id === activeIdFinal}
      onRollback={setConfirmTarget}
      onDeleted={() => {
        setActiveId(null);
        void refreshDeployments();
      }}
    />
  );

  const renderGroup = (title: string, group: DeploymentRecord[]) =>
    group.length > 0 ? (
      <div className="flex flex-col gap-2" data-testid={`deployment-group-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-dim">
          {title}
        </h3>
        {group.map(renderCard)}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-text-dim">
        {deployments.length} publish{deployments.length > 1 ? "es" : ""} —
        restoring an older version does not change your project in the editor.
      </p>

      {renderGroup("In progress", inProgress)}
      {renderGroup("Current", currentDeployment)}
      {renderGroup("Previous", previous)}
      {renderGroup("Failed", failed)}

      {rollbackError && (
        <p className="text-xs text-red-400" data-testid="rollback-error">
          {rollbackError}
        </p>
      )}

      {/* Rollback confirmation */}
      {confirmTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rollback-confirm-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <div className="flex items-start justify-between">
              <h3
                id="rollback-confirm-title"
                className="text-base font-semibold text-text-primary"
              >
                Restore this version?
              </h3>
              <button
                onClick={() => setConfirmTarget(null)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-dim hover:bg-base"
                aria-label="Close"
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              The published site will go back to this version. Your project in
              the editor is <strong>not</strong> changed — this only affects
              which version is live.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmTarget(null)}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted hover:bg-base"
                type="button"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRollback}
                disabled={rollbackBusy}
                className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                type="button"
                data-testid="rollback-confirm"
              >
                {rollbackBusy ? "Restoring…" : "Restore version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function findActive(deployments: DeploymentRecord[]): DeploymentRecord | null {
  const live = deployments.filter((d) => d.status === "live");
  if (live.length === 0) return null;
  return live.sort((a, b) =>
    (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
      a.activatedAt ?? a.completedAt ?? a.createdAt,
    ),
  )[0];
}

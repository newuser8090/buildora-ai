"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — conflict review card
//
// For each conflict shows: saved-piece name, "This device" version, "Cloud"
// version, modified times, lightweight previews, and choices:
//   Keep this device / Keep cloud version / Keep both / Review later
//
// "Keep both" creates independent records with fresh ids (see
// ConflictResolverService) — BlockTrees are never silently overwritten.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Loader2, Check, Copy, Clock, Cloud } from "lucide-react";
import type { CloudConflictRecord } from "../types";
import { MyBlockPreview } from "@/features/my-blocks/components/MyBlockPreview";
import type { MyBlockRecord } from "@/features/my-blocks/types";
import type { CloudMyBlockPayload } from "../types";
import { resolveConflict } from "../sync-runtime";

interface CloudConflictCardProps {
  conflict: CloudConflictRecord;
  onResolved: () => void;
}

const KIND_LABELS: Record<CloudConflictRecord["kind"], string> = {
  tree: "Design changed on both sides",
  "delete-edit": "Deleted on one side, edited on the other",
  collection: "Collection changed on both sides",
  "unsupported-version": "Made with a newer Buildora",
};

function nameOf(conflict: CloudConflictRecord): string {
  const local = conflict.localRecord as Partial<MyBlockRecord> | undefined;
  const cloud = conflict.cloudRecord as Partial<CloudMyBlockPayload> | undefined;
  return local?.name ?? cloud?.name ?? "Saved piece";
}

function modifiedAtOf(record: unknown): string | null {
  const candidate = record as { updatedAt?: unknown; updated_at?: unknown } | undefined;
  const value = candidate?.updatedAt ?? candidate?.updated_at;
  return typeof value === "string" ? value : null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CloudConflictCard({ conflict, onResolved }: CloudConflictCardProps) {
  const [busy, setBusy] = useState<null | "keep-local" | "keep-cloud" | "keep-both" | "review-later">(null);
  const [error, setError] = useState<string | null>(null);

  const localRecord = conflict.localRecord as Partial<MyBlockRecord> | undefined;
  const cloudRecord = conflict.cloudRecord as Partial<CloudMyBlockPayload> | undefined;

  const localTree = localRecord?.tree;
  const cloudTree = cloudRecord?.tree;
  const name = nameOf(conflict);
  const localTime = modifiedAtOf(localRecord);
  const cloudTime = modifiedAtOf(cloudRecord);

  const action = useMemo(
    () => [
      { key: "keep-local" as const, label: "Keep this device", icon: <Check className="h-3.5 w-3.5" />, tone: "text-text-primary hover:bg-base" },
      { key: "keep-cloud" as const, label: "Keep cloud version", icon: <Cloud className="h-3.5 w-3.5" />, tone: "text-text-primary hover:bg-base" },
      { key: "keep-both" as const, label: "Keep both", icon: <Copy className="h-3.5 w-3.5" />, tone: "text-text-primary hover:bg-base" },
      { key: "review-later" as const, label: "Review later", icon: <Clock className="h-3.5 w-3.5" />, tone: "text-text-dim hover:bg-base" },
    ],
    [],
  );

  const handleAction = async (key: (typeof action)[number]["key"]) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    const ok = await resolveConflict(conflict.id, key);
    setBusy(null);
    if (ok) {
      onResolved();
    } else {
      setError("Couldn't save that choice. Please try again.");
    }
  };

  return (
    <div
      className="rounded-xl border border-border bg-card p-4"
      data-testid="cloud-conflict-card"
      data-conflict-kind={conflict.kind}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-text-primary">{name}</h4>
          <p className="mt-0.5 text-xs text-amber-400">{KIND_LABELS[conflict.kind]}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> This device · {formatTime(localTime)}
          </p>
          {localTree ? (
            <MyBlockPreview tree={localTree} height={96} maxNodes={20} />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-dim">
              Deleted on this device
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Cloud · {formatTime(cloudTime)}
          </p>
          {cloudTree ? (
            <MyBlockPreview tree={cloudTree} height={96} maxNodes={20} />
          ) : (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-dim">
              Deleted in the cloud
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {action.map((a) => (
          <button
            key={a.key}
            onClick={() => void handleAction(a.key)}
            disabled={busy !== null}
            className={`flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50 ${a.tone}`}
            type="button"
          >
            {busy === a.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : a.icon}
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

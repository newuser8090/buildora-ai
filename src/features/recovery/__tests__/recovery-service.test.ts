// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — service tests
//
//   - capture: validates + deep-clones, records reason/revision
//   - bounded retention: MAX_RECOVERY_SNAPSHOTS_PER_PROJECT, oldest evicted
//   - autosave cooldown vs forced manual captures
//   - invalid snapshots rejected (schema)
//   - prepareRestore: validates, keeps project id, rejects wrong-project
//   - restore never overwrites current content by itself (write is caller's)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import {
  IndexedDbRecoveryStorage,
  setRecoveryStorageForTests,
} from "../storage/recovery-storage";
import {
  MAX_RECOVERY_SNAPSHOTS_PER_PROJECT,
  RECOVERY_AUTOSAVE_COOLDOWN_MS,
  RecoveryService,
  setRecoveryServiceForTests,
} from "../services/recovery-service";
import { DATABASE_VERSION } from "@/features/persistence/constants";
import type { Project } from "@/types/project";

let counter = 0;

function makeProject(id = "proj-r"): Project {
  return {
    id,
    name: "Recovery Project",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s1",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Recover me", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function freshService(): Promise<RecoveryService> {
  counter += 1;
  const storage = new IndexedDbRecoveryStorage({
    dbName: `recovery-service-${counter}`,
    dbVersion: DATABASE_VERSION,
  });
  const service = new RecoveryService(storage);
  service.resetCooldownsForTests();
  return service;
}

describe("RecoveryService — capture", () => {
  it("captures a validated, deep-cloned snapshot", async () => {
    const service = await freshService();
    const project = makeProject();
    const result = await service.capture({
      project,
      revision: 3,
      reason: "manual",
      now: "2026-08-01T00:00:00.000Z",
      force: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.revision).toBe(3);
    expect(result.snapshot.reason).toBe("manual");
    expect(result.snapshot.project.id).toBe("proj-r");

    // Mutating the source later must not corrupt the snapshot.
    project.pages[0].sections[0].props.headline = "CHANGED";
    const list = await service.listSnapshots("proj-r");
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.snapshots[0].project.pages[0].sections[0].props.headline).toBe("Recover me");
    }
  });

  it("rejects an invalid project (fails ProjectSchema)", async () => {
    const service = await freshService();
    const result = await service.capture({
      project: { ...makeProject(), pages: "nope" } as never,
      revision: 1,
      reason: "manual",
      force: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RECOVERY_SNAPSHOT_INVALID");
  });

  it("applies the autosave cooldown but force bypasses it", async () => {
    const service = await freshService();
    const project = makeProject();

    // First autosave capture is allowed (cooldown empty).
    const first = await service.capture({ project, revision: 1, reason: "autosave" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.skipped).toBe(false);

    // Second autosave capture within the cooldown is skipped.
    const second = await service.capture({ project, revision: 2, reason: "autosave" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.skipped).toBe(true);

    // A forced manual capture always runs.
    const third = await service.capture({ project, revision: 3, reason: "manual", force: true });
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.skipped).toBe(false);

    const list = await service.listSnapshots(project.id);
    if (list.ok) expect(list.snapshots).toHaveLength(2);
  });

  it("bounds retention to the newest MAX per project, evicting oldest", async () => {
    const service = await freshService();
    const project = makeProject();

    for (let i = 1; i <= MAX_RECOVERY_SNAPSHOTS_PER_PROJECT + 3; i += 1) {
      const result = await service.capture({
        project,
        revision: i,
        reason: "manual",
        now: `2026-08-0${i}T00:00:00.000Z`,
        force: true,
      });
      expect(result.ok).toBe(true);
    }

    const list = await service.listSnapshots(project.id);
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.snapshots).toHaveLength(MAX_RECOVERY_SNAPSHOTS_PER_PROJECT);
      // Newest first — the evicted oldest revisions are gone.
      expect(list.snapshots[0].revision).toBe(MAX_RECOVERY_SNAPSHOTS_PER_PROJECT + 3);
      expect(list.snapshots[list.snapshots.length - 1].revision).toBe(MAX_RECOVERY_SNAPSHOTS_PER_PROJECT - 1);
    }
  });
});

describe("RecoveryService — restore", () => {
  it("prepareRestore validates and keeps the project id", async () => {
    const service = await freshService();
    const project = makeProject("proj-r");
    const captured = await service.capture({
      project,
      revision: 2,
      reason: "manual",
      force: true,
      now: "2026-08-01T00:00:00.000Z",
    });
    if (!captured.ok) return;

    const prepared = await service.prepareRestore(captured.snapshot.id, "proj-r");
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.project.id).toBe("proj-r");
      expect(prepared.revision).toBe(2);
      expect(prepared.project.pages[0].sections[0].props.headline).toBe("Recover me");
    }
  });

  it("rejects a snapshot belonging to a different project", async () => {
    const service = await freshService();
    const captured = await service.capture({
      project: makeProject("proj-a"),
      revision: 1,
      reason: "manual",
      force: true,
    });
    if (!captured.ok) return;
    const prepared = await service.prepareRestore(captured.snapshot.id, "proj-b");
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.error.code).toBe("RECOVERY_SNAPSHOT_INVALID");
  });

  it("rejects a missing snapshot", async () => {
    const service = await freshService();
    const prepared = await service.prepareRestore("snap-missing", "proj-r");
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.error.code).toBe("RECOVERY_NOT_FOUND");
  });
});

describe("RecoveryService — lifecycle", () => {
  it("clearForProject removes every snapshot for the project", async () => {
    const service = await freshService();
    await service.capture({ project: makeProject("proj-a"), revision: 1, reason: "manual", force: true });
    await service.capture({ project: makeProject("proj-b"), revision: 1, reason: "manual", force: true });
    await service.clearForProject("proj-a");
    const a = await service.listSnapshots("proj-a");
    const b = await service.listSnapshots("proj-b");
    if (a.ok) expect(a.snapshots).toHaveLength(0);
    if (b.ok) expect(b.snapshots).toHaveLength(1);
  });
});

void RECOVERY_AUTOSAVE_COOLDOWN_MS;
void setRecoveryStorageForTests;
void setRecoveryServiceForTests;

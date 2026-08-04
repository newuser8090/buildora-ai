// ---------------------------------------------------------------------------
// Diff builder — safe, structured change representation for the review UI
//
// Turns the simulator's before/after snapshots into a small set of typed
// fields per operation (text/structure/visibility/metadata/page). It never
// dumps raw JSON of the whole project; long values are capped and Unicode is
// preserved.
// ---------------------------------------------------------------------------

import type { Page, Project } from "@/types/project";
import type {
  AiEditDiff,
  AiEditDiffField,
  AiEditOperation,
} from "../plan-types";

const MAX_FIELD_CHARS = 500;

function truncate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_FIELD_CHARS)}…`;
}

function findPage(project: Project, pageId: string): Page | undefined {
  return project.pages.find((p) => p.id === pageId);
}

function sectionIndex(project: Project, pageId: string, sectionId: string): number {
  const page = findPage(project, pageId);
  if (!page) return -1;
  return page.sections.findIndex((s) => s.id === sectionId);
}

function sectionLabelAt(project: Project, pageId: string, sectionId: string): string {
  const page = findPage(project, pageId);
  if (!page) return "Unknown section";
  const section = page.sections.find((s) => s.id === sectionId);
  if (!section) return "Unknown section";
  const name = section.type.charAt(0).toUpperCase() + section.type.slice(1);
  return `${name} section`;
}

/** Diff scalar fields of two plain objects; only changed keys are emitted. */
function diffProps(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AiEditDiffField[] {
  const fields: AiEditDiffField[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const beforeValue = before[key];
    const afterValue = after[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    fields.push({
      key,
      label: key,
      before: truncate(beforeValue),
      after: truncate(afterValue),
    });
  }
  return fields;
}

function buildDiffForOperation(
  operation: AiEditOperation,
  before: Project,
  after: Project,
): AiEditDiff {
  switch (operation.type) {
    case "update-section-props": {
      const beforeSection = findPage(before, operation.pageId)?.sections.find(
        (s) => s.id === operation.sectionId,
      );
      const afterSection = findPage(after, operation.pageId)?.sections.find(
        (s) => s.id === operation.sectionId,
      );
      const fields = diffProps(
        (beforeSection?.props ?? {}) as Record<string, unknown>,
        (afterSection?.props ?? {}) as Record<string, unknown>,
      );
      return { operationId: operation.id, kind: "text", fields };
    }

    case "update-section-styles": {
      const beforeSection = findPage(before, operation.pageId)?.sections.find(
        (s) => s.id === operation.sectionId,
      );
      const afterSection = findPage(after, operation.pageId)?.sections.find(
        (s) => s.id === operation.sectionId,
      );
      const fields = diffProps(
        (beforeSection?.styles ?? {}) as Record<string, unknown>,
        (afterSection?.styles ?? {}) as Record<string, unknown>,
      );
      return { operationId: operation.id, kind: "text", fields };
    }

    case "insert-section": {
      const afterSection = findPage(after, operation.pageId)?.sections.find(
        (s) => s.id === operation.section.id,
      );
      const label = sectionLabelAt(after, operation.pageId, operation.section.id);
      return {
        operationId: operation.id,
        kind: "structure",
        fields: [
          {
            key: "section",
            label: "Added",
            after: afterSection
              ? `${label}${afterSection.visible ? "" : " (hidden)"}`
              : operation.section.type,
          },
        ],
      };
    }

    case "delete-section": {
      const beforeSection = findPage(before, operation.pageId)?.sections.find(
        (s) => s.id === operation.sectionId,
      );
      return {
        operationId: operation.id,
        kind: "structure",
        fields: [
          {
            key: "section",
            label: "Removed",
            before: beforeSection
              ? `${sectionLabelAt(before, operation.pageId, operation.sectionId)} (${beforeSection.id})`
              : operation.sectionId,
          },
        ],
      };
    }

    case "duplicate-section": {
      return {
        operationId: operation.id,
        kind: "structure",
        fields: [
          {
            key: "section",
            label: "Duplicated",
            after: `${sectionLabelAt(before, operation.pageId, operation.sectionId)} — copy added below the original`,
          },
        ],
      };
    }

    case "move-section": {
      const beforeIndex = sectionIndex(before, operation.pageId, operation.sectionId);
      const afterIndex = sectionIndex(after, operation.pageId, operation.sectionId);
      return {
        operationId: operation.id,
        kind: "structure",
        fields: [
          {
            key: "position",
            label: "Position",
            before: beforeIndex === -1 ? undefined : `#${beforeIndex + 1}`,
            after: afterIndex === -1 ? undefined : `#${afterIndex + 1}`,
          },
        ],
      };
    }

    case "set-section-visibility": {
      return {
        operationId: operation.id,
        kind: "visibility",
        fields: [
          {
            key: "visibility",
            label: "Visibility",
            before: operation.visible ? "Hidden" : "Visible",
            after: operation.visible ? "Visible" : "Hidden",
          },
        ],
      };
    }

    case "add-page": {
      return {
        operationId: operation.id,
        kind: "page",
        fields: [
          {
            key: "page",
            label: "Added page",
            after: `${operation.page.title} (${operation.page.slug})`,
          },
        ],
      };
    }

    case "rename-page": {
      const beforePage = findPage(before, operation.pageId);
      const afterPage = findPage(after, operation.pageId);
      const fields: AiEditDiffField[] = [];
      if (beforePage || afterPage) {
        fields.push({
          key: "title",
          label: "Title",
          before: beforePage?.title,
          after: afterPage?.title,
        });
      }
      if (
        (beforePage?.slug ?? "") !== (afterPage?.slug ?? "")
      ) {
        fields.push({
          key: "route",
          label: "Route",
          before: beforePage?.slug,
          after: afterPage?.slug,
        });
      }
      return { operationId: operation.id, kind: "page", fields };
    }

    case "delete-page": {
      const beforePage = findPage(before, operation.pageId);
      return {
        operationId: operation.id,
        kind: "page",
        fields: [
          {
            key: "page",
            label: "Removed page",
            before: beforePage ? `${beforePage.title} (${beforePage.slug})` : operation.pageId,
          },
        ],
      };
    }

    case "move-page": {
      const beforeIndex = before.pages.findIndex((p) => p.id === operation.pageId);
      const afterIndex = after.pages.findIndex((p) => p.id === operation.pageId);
      return {
        operationId: operation.id,
        kind: "page",
        fields: [
          {
            key: "position",
            label: "Position",
            before: beforeIndex === -1 ? undefined : `#${beforeIndex + 1}`,
            after: afterIndex === -1 ? undefined : `#${afterIndex + 1}`,
          },
        ],
      };
    }

    case "update-page-meta": {
      const beforePage = findPage(before, operation.pageId);
      const afterPage = findPage(after, operation.pageId);
      const fields: AiEditDiffField[] = [];
      const beforeMeta = (beforePage?.meta ?? {}) as Record<string, unknown>;
      const afterMeta = (afterPage?.meta ?? {}) as Record<string, unknown>;
      for (const key of ["title", "description"]) {
        const beforeValue = beforeMeta[key];
        const afterValue = afterMeta[key];
        if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
        fields.push({
          key,
          label: key === "title" ? "Meta title" : "Meta description",
          before: truncate(beforeValue),
          after: truncate(afterValue),
        });
      }
      return { operationId: operation.id, kind: "metadata", fields };
    }

    default:
      // Exhaustive switch — unreachable; keep a defensive fallback.
      return {
        operationId: (operation as AiEditOperation).id,
        kind: "text",
        fields: [],
      };
  }
}

/**
 * Build diffs for a plan from the simulator's snapshots.
 *
 * @param operations The operations, in plan order.
 * @param snapshots  Snapshots from simulatePlan: snapshots[i] is the project
 *                   state before operation i, snapshots[i+1] after it. Length
 *                   must equal operations.length + 1.
 */
export function buildDiffs(
  operations: AiEditOperation[],
  snapshots: Project[],
): AiEditDiff[] {
  if (snapshots.length !== operations.length + 1) return [];
  return operations.map((op, index) =>
    buildDiffForOperation(op, snapshots[index], snapshots[index + 1]),
  );
}

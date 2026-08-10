// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — permission matrix
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  canManageWorkspace,
  canInviteMembers,
  canChangeRoles,
  canLeaveWorkspace,
  canCreateProjects,
  canMoveProjects,
  canEditProject,
  canSaveProject,
  canDeleteProject,
  canDuplicateProject,
  canCopyToPersonal,
  canPublishProject,
  canManageDomains,
  canManageReviewLinks,
  canHoldEditLease,
} from "../permissions/workspace-permissions";

const ROLES = ["owner", "editor", "viewer"] as const;

describe("workspace permission matrix", () => {
  it("owner can do everything except leave", () => {
    expect(canManageWorkspace("owner")).toBe(true);
    expect(canInviteMembers("owner")).toBe(true);
    expect(canChangeRoles("owner")).toBe(true);
    expect(canCreateProjects("owner")).toBe(true);
    expect(canMoveProjects("owner")).toBe(true);
    expect(canEditProject("owner")).toBe(true);
    expect(canSaveProject("owner")).toBe(true);
    expect(canDeleteProject("owner")).toBe(true);
    expect(canDuplicateProject("owner")).toBe(true);
    expect(canCopyToPersonal("owner")).toBe(true);
    expect(canPublishProject("owner")).toBe(true);
    expect(canManageDomains("owner")).toBe(true);
    expect(canManageReviewLinks("owner")).toBe(true);
    expect(canHoldEditLease("owner")).toBe(true);
    expect(canLeaveWorkspace("owner")).toBe(false);
  });

  it("editor can edit, create, publish, and manage review links but never manage members", () => {
    expect(canEditProject("editor")).toBe(true);
    expect(canSaveProject("editor")).toBe(true);
    expect(canHoldEditLease("editor")).toBe(true);
    expect(canCreateProjects("editor")).toBe(true);
    expect(canMoveProjects("editor")).toBe(true);
    expect(canDuplicateProject("editor")).toBe(true);
    expect(canCopyToPersonal("editor")).toBe(true);
    expect(canPublishProject("editor")).toBe(true);
    expect(canManageReviewLinks("editor")).toBe(true);
    expect(canLeaveWorkspace("editor")).toBe(true);
    // Owner-only
    expect(canManageWorkspace("editor")).toBe(false);
    expect(canInviteMembers("editor")).toBe(false);
    expect(canChangeRoles("editor")).toBe(false);
    expect(canDeleteProject("editor")).toBe(false);
    expect(canManageDomains("editor")).toBe(false);
  });

  it("viewer is read-only everywhere", () => {
    for (const role of ROLES) {
      const isViewer = role === "viewer";
      expect(canEditProject(role)).toBe(!isViewer);
      expect(canSaveProject(role)).toBe(!isViewer);
      expect(canHoldEditLease(role)).toBe(!isViewer);
      expect(canPublishProject(role)).toBe(!isViewer);
      expect(canCreateProjects(role)).toBe(!isViewer);
      expect(canManageReviewLinks(role)).toBe(!isViewer);
      expect(canLeaveWorkspace(role)).toBe(role !== "owner");
    }
    expect(canManageWorkspace("viewer")).toBe(false);
    expect(canInviteMembers("viewer")).toBe(false);
    expect(canChangeRoles("viewer")).toBe(false);
    expect(canDeleteProject("viewer")).toBe(false);
    expect(canManageDomains("viewer")).toBe(false);
    expect(canDuplicateProject("viewer")).toBe(false);
    expect(canCopyToPersonal("viewer")).toBe(false);
    expect(canMoveProjects("viewer")).toBe(false);
  });

  it("viewer can leave (non-destructive) but not manage anything", () => {
    expect(canLeaveWorkspace("viewer")).toBe(true);
    expect(canManageWorkspace("viewer")).toBe(false);
  });

  it("permission helpers are deterministic across calls", () => {
    for (const role of ROLES) {
      const first = [
        canManageWorkspace(role),
        canEditProject(role),
        canPublishProject(role),
        canManageDomains(role),
      ];
      const second = [
        canManageWorkspace(role),
        canEditProject(role),
        canPublishProject(role),
        canManageDomains(role),
      ];
      expect(second).toEqual(first);
    }
  });
});

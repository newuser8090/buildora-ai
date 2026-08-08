// ---------------------------------------------------------------------------
// AI Copilot — quality assistant tests (spec §12)
//   - deterministic finding → plain-language explanation
//   - fix-plan mapping for findings the op-set can genuinely fix
//   - drafted content for site-settings findings
//   - the readiness score is never altered or fabricated
//   - fixing a finding routes through the normal plan flow
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  explainFinding,
  draftSiteDescription,
  draftSiteTitle,
  isBlockingFinding,
  READINESS_AUTHORITY_NOTE,
  type QualityFindingHelp,
} from "../services/quality-assistant";
import { MOCK_PROJECT } from "./helpers";
import type { Project } from "@/types/project";
import type { LaunchCheck } from "@/features/launch-readiness/types";

function cloneProject(): Project {
  return JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
}

function finding(overrides: Partial<LaunchCheck>): LaunchCheck {
  return {
    id: "placeholder-text",
    title: "Placeholder text found",
    explanation: "Some sections still contain placeholder copy like 'lorem ipsum'.",
    suggestedAction: "Replace placeholder copy with real content.",
    status: "warning",
    severity: "minor",
    ...overrides,
  } as LaunchCheck;
}

describe("draftSiteDescription", () => {
  it("drafts a description from real visible page copy, capped at 155 chars", () => {
    const project = cloneProject();
    const draft = draftSiteDescription(project);
    expect(draft.length).toBeLessThanOrEqual(155);
    expect(draft).toContain("SaaS Landing Page");
  });

  it("falls back to a safe generic draft for projects with no copy", () => {
    const project = cloneProject();
    project.name = "Empty Site";
    project.pages[0].sections = project.pages[0].sections.map((s) => ({
      ...s,
      props: { title: "T", subtitle: "" },
    }));
    const draft = draftSiteDescription(project);
    expect(draft.length).toBeLessThanOrEqual(155);
    expect(draft).toBeTruthy();
  });
});

describe("draftSiteTitle", () => {
  it("derives a title from the project name", () => {
    const project = cloneProject();
    expect(draftSiteTitle(project)).toBe("SaaS Landing Page");
  });
});

describe("explainFinding — plan-kind findings", () => {
  it("maps placeholder-text to a project fix plan", () => {
    const help = explainFinding(finding({}), cloneProject());
    expect(help.fixKind).toBe("plan");
    expect(help.planInstruction).toContain("placeholder");
    expect(help.planScope).toEqual({ type: "project" });
  });

  it("maps empty-pages to a page-scoped plan when one empty page exists", () => {
    const project = cloneProject();
    project.pages = [
      ...project.pages,
      { ...project.pages[0], id: "page-2", title: "Blog", slug: "/blog", sections: [] },
    ];
    const help = explainFinding(
      finding({ id: "empty-pages", title: "Empty pages" }),
      project,
    );
    expect(help.fixKind).toBe("plan");
    expect(help.planScope).toEqual({ type: "page", pageId: "page-2" });
  });

  it("keeps the deterministic explanation and suggested action verbatim", () => {
    const f = finding({});
    const help = explainFinding(f, cloneProject());
    expect(help.explanation).toContain(f.explanation);
    expect(help.explanation).toContain(f.suggestedAction!);
  });
});

describe("explainFinding — draft-content findings", () => {
  it("drafts a site description for the seo-description finding", () => {
    const help = explainFinding(
      finding({ id: "seo-description", title: "No search description" }),
      cloneProject(),
    );
    expect(help.fixKind).toBe("draft-content");
    expect(help.draft).toBeTruthy();
    expect(help.openDialog).toBe("site-settings-search");
  });

  it("drafts a site title for the seo-title finding", () => {
    const help = explainFinding(
      finding({ id: "seo-title", title: "No search title" }),
      cloneProject(),
    );
    expect(help.fixKind).toBe("draft-content");
    expect(help.draft).toBe("SaaS Landing Page");
  });
});

describe("explainFinding — explain-only findings", () => {
  it("returns explain-only for findings the op-set cannot fix", () => {
    const help = explainFinding(
      finding({ id: "favicon-missing", title: "Missing favicon" }),
      cloneProject(),
    );
    expect(help.fixKind).toBe("explain-only");
    expect(help.planInstruction).toBeUndefined();
  });
});

describe("isBlockingFinding", () => {
  it("only blocks on critical failures", () => {
    expect(isBlockingFinding(finding({ status: "fail", severity: "critical" }))).toBe(true);
    expect(isBlockingFinding(finding({ status: "fail", severity: "major" }))).toBe(false);
    expect(isBlockingFinding(finding({ status: "warning", severity: "critical" }))).toBe(false);
  });
});

describe("readiness authority boundary", () => {
  it("exposes an explicit note that the Copilot cannot change the score", () => {
    expect(READINESS_AUTHORITY_NOTE).toMatch(/score/i);
    expect(READINESS_AUTHORITY_NOTE).toMatch(/can't change it directly/i);
  });

  it("never writes to a score field — the help object has no score key", () => {
    const project = cloneProject();
    const help: QualityFindingHelp = explainFinding(finding({}), project);
    expect(JSON.stringify(help)).not.toContain('"score"');
    expect(JSON.stringify(help)).not.toContain('"checks"');
  });

  it("prepares a fix plan that routes through the normal plan pipeline", () => {
    // The fix plan is an instruction + scope — the Copilot service will call
    // the canonical runPlanEdit with it. Applying still requires approval.
    const help = explainFinding(finding({}), cloneProject());
    expect(help.fixKind).toBe("plan");
    expect(help.planInstruction).toBeTruthy();
    expect(help.planScope).toBeTruthy();
  });
});

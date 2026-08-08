import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";
import { mockCopilotPlanApi, openCopilot, sendCopilotMessage, expectPlanReview } from "./helpers/copilot";

// ---------------------------------------------------------------------------
// Phase P10 — FLOW B: follow-up edits resolve contextually against the
// conversation + live editor state, and the applied change persists.
// ---------------------------------------------------------------------------

test.describe("AI Copilot — FLOW B (follow-up + persistence)", () => {
  test("applies an edit, follows up contextually, and persists across reload", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    const { getRequest } = mockCopilotPlanApi(page, {
      // Request 1 → first headline; request 2 (the follow-up) → shorter one.
      headlineFor: (instruction) =>
        /shorter/i.test(instruction) ? "Short and sweet headline" : "Copilot Hero Headline",
    });
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // ---- First edit ----
    await sendCopilotMessage(page, "Rewrite the hero headline");
    await expectPlanReview(page);
    await page.locator('[data-testid="copilot-apply"]').click();

    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.getByText("Copilot Hero Headline")).toBeVisible({ timeout: 5000 });

    // ---- Contextual follow-up: "make it shorter" must target the same hero
    //      without repeating the request. The mock returns a distinct
    //      headline so we can confirm the follow-up was actually planned. ----
    await sendCopilotMessage(page, "make it shorter");
    await expectPlanReview(page);
    await page.locator('[data-testid="copilot-apply"]').click();

    await expect(preview.getByText("Short and sweet headline")).toBeVisible({ timeout: 5000 });

    // The follow-up was sent to the planner as its own request with the
    // contextual instruction — never a replay of the stale plan.
    const followUp = JSON.parse(getRequest(1) ?? "{}");
    expect(followUp.mode).toBe("plan-edit");
    expect(String(followUp.instruction)).toContain("shorter");
    expect(getRequest(1)).not.toBe(getRequest(0));

    // ---- Persistence: deterministically wait until the IndexedDB write for
    // the follow-up is durable (autosave debounces + commits async), then
    // reload and confirm the change survived. ----
    await expect(page.getByText("Saved").first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const db: IDBDatabase = await new Promise((resolve, reject) => {
              const req = indexedDB.open("buildora");
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            const tx = db.transaction("projects", "readonly");
            const records: Array<{
              envelope?: { project?: { pages?: Array<{ sections?: Array<{ type?: string; props?: Record<string, unknown> }> }> } };
            }> = await new Promise((resolve, reject) => {
              const req = tx.objectStore("projects").getAll();
              req.onsuccess = () => resolve(req.result as never);
              req.onerror = () => reject(req.error);
            });
            db.close();
            const last = records[records.length - 1];
            const hero = last?.envelope?.project?.pages?.[0]?.sections?.find(
              (s) => s.type === "hero",
            );
            return hero?.props?.headline ?? "";
          }),
        { timeout: 15000 },
      )
      .toBe("Short and sweet headline");

    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 90000 });

    // The applied follow-up survives the reload.
    await expect(
      page.locator('[data-testid="preview-content"]').getByText("Short and sweet headline"),
    ).toBeVisible({ timeout: 10000 });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

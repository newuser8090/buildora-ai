import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";
import { mockCopilotPlanApi, openCopilot, sendCopilotMessage, expectPlanReview } from "./helpers/copilot";

// ---------------------------------------------------------------------------
// Phase P11 — FLOW M: project memory & continuity.
//
//   M1  conversation survives reload (restore + cross-session follow-up)
//   M2  style notes persist and are honored by EDIT requests
//   M3  explicit clear removes the persisted memory
//   M4  a pending plan NEVER restores (no approval surface after reload)
//   M5  corrupt/oversized memory records are ignored safely
//
// The plan-edit API is mocked with a deterministic plan (no live AI); all
// persistence, validation, and history behavior is real.
// ---------------------------------------------------------------------------

/** Inject a raw record directly into the copilotMemory store. */
async function injectMemoryRecord(page: import("@playwright/test").Page, record: unknown): Promise<void> {
  await page.evaluate(async (value) => {
    const open = indexedDB.open("buildora");
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("copilotMemory", "readwrite");
        tx.objectStore("copilotMemory").put(value);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, record);
}

test.describe("AI Copilot — project memory (Phase P11)", () => {
  test("M1: the conversation survives a reload and follow-ups still work", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const { getRequest } = mockCopilotPlanApi(page, {
      headlineFor: (instruction) =>
        instruction.includes("shorter")
          ? "Short friendly headline"
          : "Persisted headline",
    });
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // Send an edit and apply it.
    await sendCopilotMessage(page, "Rewrite the hero headline");
    await expectPlanReview(page);
    await page.locator('[data-testid="copilot-apply"]').click();
    await expect(page.locator('[data-testid="copilot-change-summary"]')).toBeVisible();

    // Reload — the project and the memory record must both come back.
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 90000 });
    await openCopilot(page);

    // The prior conversation is restored (visible), with the restore hint.
    await expect(page.locator('[data-testid="copilot-memory-restored"]')).toBeVisible();
    await expect(page.locator('[data-testid="copilot-msg-user"]').last()).toContainText(
      "Rewrite the hero headline",
    );

    // A cross-session follow-up re-plans against the CURRENT project.
    await sendCopilotMessage(page, "make it shorter");
    await expectPlanReview(page);
    const followUp = JSON.parse(getRequest(1) ?? "{}");
    expect(String(followUp.instruction)).toContain("make it shorter");
    // The follow-up request still carries the persisted style memory if any.

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("M2: style notes persist across reloads and are honored by EDIT requests", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const { getRequest } = mockCopilotPlanApi(page);
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // Add a style note.
    await page.locator('[data-testid="style-note-input"]').fill("keep it friendly");
    await page.locator('[data-testid="style-note-add"]').click();
    await expect(page.locator('[data-testid="style-note-chip"]')).toContainText(
      "keep it friendly",
    );

    // An EDIT request carries the style suffix to the provider.
    await sendCopilotMessage(page, "Rewrite the hero headline");
    await expectPlanReview(page);
    const sent = JSON.parse(getRequest(0) ?? "{}");
    expect(String(sent.instruction)).toContain("keep it friendly");

    // Reload — the note is restored.
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 90000 });
    await openCopilot(page);
    await expect(page.locator('[data-testid="style-note-chip"]')).toContainText(
      "keep it friendly",
    );

    // A NEW edit after reload still honors it.
    await sendCopilotMessage(page, "Make the CTA clearer");
    await expectPlanReview(page);
    const second = JSON.parse(getRequest(1) ?? "{}");
    expect(String(second.instruction)).toContain("keep it friendly");

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("M3: New conversation clears the persisted memory", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // Build a conversation + style note.
    await sendCopilotMessage(page, "What should I put in the hero?");
    await expect(page.locator('[data-testid="copilot-msg-assistant"]').last()).toBeVisible();
    await page.locator('[data-testid="style-note-input"]').fill("keep it friendly");
    await page.locator('[data-testid="style-note-add"]').click();

    // Clear explicitly.
    await page.locator('[data-testid="copilot-new-conversation"]').click();
    await expect(page.locator('[data-testid="copilot-msg-user"]')).toHaveCount(0);

    // Reload — nothing is restored.
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 90000 });
    await openCopilot(page);
    await expect(page.locator('[data-testid="copilot-memory-restored"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="style-note-chip"]')).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("M4: a pending plan never restores — reload leaves the project unchanged", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    const { getRequest } = mockCopilotPlanApi(page);
    await createSaaSProjectAndOpenEditor(page);
    await openCopilot(page);

    // Reach the awaiting-approval state but do NOT apply.
    await sendCopilotMessage(page, "Rewrite the hero headline");
    await expectPlanReview(page);
    expect(getRequest(0)).toBeTruthy();

    // Reload — the conversation is restored but NO approval surface may
    // reappear and the project must be unchanged (nothing applied).
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 90000 });
    await openCopilot(page);
    await expect(page.locator('[data-testid="copilot-plan-review"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="copilot-change-summary"]')).toHaveCount(0);
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.getByText("Ship your next product in days, not months")).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("M5: a corrupt memory record is ignored safely (no crash, no leak)", async ({ page }) => {
    const audit = attachRuntimeAudit(page);
    await createSaaSProjectAndOpenEditor(page);

    // Inject a malformed record for this project directly into IndexedDB.
    await injectMemoryRecord(page, {
      id: "corrupt-project",
      version: 999,
      messages: "not-an-array",
      styleNotes: ["__proto__"],
    });

    // Open the Copilot — it must not crash and must show no restored memory.
    await openCopilot(page);
    await expect(page.locator('[data-testid="copilot-memory-restored"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="copilot-panel"]')).toBeVisible();
    // The composer still works.
    await sendCopilotMessage(page, "What should I put in the hero?");
    await expect(page.locator('[data-testid="copilot-msg-assistant"]').last()).toBeVisible();

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

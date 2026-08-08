import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createBlankProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P9 — draft recovery (spec §59)
//
// Flow:
//   1. create a project
//   2. edit content
//   3. save — a bounded recovery snapshot is captured (reason: autosave)
//   4. edit content again (the "newer" state differs from the snapshot)
//   5. open the recovery dialog from the editor TopNav
//   6. a backup is listed (Auto-saved)
//   7. preview the backup (read-only, no restore)
//   8. restore it (explicit confirmation)
//   9. verify the recovered content (headline is back to the snapshot state)
//  10. no runtime errors
//
// The recovery dialog only restores through the normal persistence save path
// and never auto-overwrites current content without explicit confirmation.
// ---------------------------------------------------------------------------

async function editHeadlineInline(
  page: Page,
  currentText: string,
  nextText: string,
): Promise<void> {
  const preview = page.locator('[data-testid="preview-content"]');
  const headline = preview.getByText(currentText, { exact: true });
  await expect(headline).toBeVisible({ timeout: 5000 });
  await headline.click();
  await expect(page.locator('[data-testid="inline-toolbar"]')).toBeVisible({
    timeout: 5000,
  });
  await headline.dblclick();
  await expect(page.locator('[data-testid="inline-edit-overlay"]')).toBeVisible();
  await page.locator('[data-testid="inline-edit-input"]').fill(nextText);
  await page.locator('[data-testid="inline-edit-save"]').click();
  await expect(preview.getByText(nextText, { exact: true })).toBeVisible({
    timeout: 5000,
  });
}

test.describe("Phase P9 — draft recovery", () => {
  test("snapshot → changed content → preview → restore → recovered", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    // 1. Create a project (blank template ships one hero section).
    await createBlankProjectAndOpenEditor(page);
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });

    // 2. Edit the headline to the "good" state.
    const goodHeadline = "The good saved version";
    await editHeadlineInline(page, "Your new project", goodHeadline);

    // 3. Save — the coordinator flush emits "saved", which schedules a bounded
    //    recovery snapshot of this content. Give the async (non-blocking)
    //    snapshot write a moment to land before the dialog lists backups.
    await page.locator('[data-testid="topnav-save-button"]').click();
    await expect(page.locator('[data-testid="topnav-save-button"]')).toContainText(
      "Saved",
      { timeout: 10000 },
    );
    await page.waitForTimeout(1000);

    // 4. Edit again — the latest state now differs from the snapshot.
    const latestHeadline = "The newest unsnapshotted state";
    await editHeadlineInline(page, goodHeadline, latestHeadline);
    await page.waitForTimeout(500);

    // 5. Open the recovery dialog from the TopNav.
    await page.locator('[data-testid="topnav-recovery-button"]').click();
    const recoveryDialog = page.getByRole("dialog", {
      name: "Found a recent backup",
    });
    await expect(recoveryDialog).toBeVisible({ timeout: 10000 });

    // 6. A backup exists (captured after the first save).
    await expect(
      recoveryDialog.locator('[data-testid="recovery-snapshot"]').first(),
    ).toBeVisible({ timeout: 10000 });
    await expect(recoveryDialog.getByText("Auto-saved")).toBeVisible();

    // 7. Preview the backup — read-only, does NOT restore. The preview shows
    //    the snapshot project's name and page list (not the restored editor).
    await recoveryDialog
      .locator('button[aria-label^="Preview backup from"]')
      .first()
      .click();
    const previewPanel = recoveryDialog.locator('[data-testid="recovery-preview"]');
    await expect(previewPanel).toBeVisible();
    await expect(previewPanel.getByText("Untitled Project")).toBeVisible();
    await expect(previewPanel.getByText(/Home — .* part/)).toBeVisible();

    // 8. Restore it (explicit confirmation).
    await recoveryDialog
      .locator('[data-testid="recovery-snapshot"]')
      .first()
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(
      recoveryDialog.getByRole("dialog", { name: "Confirm restore" }),
    ).toBeVisible();
    await recoveryDialog.locator('[data-testid="recovery-confirm-restore"]').click();

    // Restore writes through the persistence path and reloads the editor.
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 90000,
    });

    // 9. The recovered content is the snapshot state, not the latest state.
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(goodHeadline, { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page
        .locator('[data-testid="preview-content"]')
        .getByText(latestHeadline, { exact: true }),
    ).toHaveCount(0);

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openEditor,
  openMyBlocks,
  closeMyBlocks,
  createBlockViaImport,
  signUp,
  signIn,
  chooseInitialMerge,
  expectStatusLabel,
  syncNow,
  openConflicts,
  fetchCloudBlocks,
  uploadCloudBlock,
  withEditedTree,
  editLocalBlockTree,
  uniqueSuffix,
} from "./helpers/cloud-sync";

// ---------------------------------------------------------------------------
// Phase P6 — E2E: conflict detection & resolution
//
// Both devices share the same cloud block, then its design is changed on
// BOTH sides:
//   - the CLOUD copy is edited through the app's own API route (simulates
//     device two editing + syncing), and
//   - THIS device's local record is edited in IndexedDB (the data state a UI
//     design edit would produce — the product intentionally has no "edit
//     saved block" UI yet).
//
// The conflict DETECTION (baseline hashes + contentRevision), the conflict
// dialog, "Keep both" (independent records with fresh ids, duplicate-safe
// naming), durability across reload, and the other device's download are all
// real product behavior.
// ---------------------------------------------------------------------------

test.describe("Cloud sync — conflict resolution", () => {
  test("divergent BlockTrees → conflict → Keep both → two independent records → durable", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const email = `carol-${uniqueSuffix()}@example.com`;
    const password = "password123";

    // ----------------------------- Device A -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    await openEditor(pageA);
    await createBlockViaImport(pageA, "Shared Hero");
    await signUp(pageA, email, password);
    await chooseInitialMerge(pageA, "Merge both");
    await expectStatusLabel(pageA, "Synced", 30000);

    // ----------------------------- Device B -----------------------------
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);

    await openEditor(pageB);
    await signIn(pageB, email, password);
    await chooseInitialMerge(pageB, "Download cloud library");
    await expectStatusLabel(pageB, "Synced", 30000);

    await openMyBlocks(pageB);
    await expect(
      pageB.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Shared Hero");
    await closeMyBlocks(pageB);

    // --- Edit the CLOUD copy (simulates device two editing the design) ---
    const cloudBlocks = await fetchCloudBlocks(pageB);
    const remote = cloudBlocks.find(
      (b) => (b as { name?: unknown }).name === "Shared Hero",
    );
    expect(remote).toBeTruthy();
    await uploadCloudBlock(pageB, withEditedTree(remote, "Edited in the cloud"));

    // --- Edit THIS device's local copy (simulates a local design edit) ---
    const localEdit = await editLocalBlockTree(pageA, "Shared Hero", "Edited on this device");
    expect(localEdit.ok).toBe(true);

    // --- Sync device A: both sides changed → conflict surfaced, not overwritten ---
    await syncNow(pageA);
    await expectStatusLabel(pageA, "1 conflict to review", 30000);

    // Open the conflict review dialog and verify it is a BlockTree conflict.
    await openConflicts(pageA);
    const dialog = pageA.getByRole("dialog", { name: "Conflicts to review" });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    const card = pageA.locator('[data-testid="cloud-conflict-card"]');
    await expect(card).toHaveCount(1, { timeout: 10000 });
    await expect(card).toHaveAttribute("data-conflict-kind", "tree");
    await expect(card).toContainText("Shared Hero");
    await expect(card).toContainText("Design changed on both sides");

    // --- Keep both: local stays, cloud version becomes an independent record ---
    await card.getByRole("button", { name: "Keep both", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
    await expect(dialog).toContainText("All caught up");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    // --- Verify two independent records with fresh ids ---
    await openMyBlocks(pageA);
    const cards = pageA.locator('[data-testid^="my-block-card-"]');
    await expect(cards).toHaveCount(2, { timeout: 10000 });
    await expect(pageA.locator('[data-testid="my-blocks-library"]')).toContainText("Shared Hero");
    await expect(pageA.locator('[data-testid="my-blocks-library"]')).toContainText("Shared Hero 2");
    const testIds = await cards.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid") as string),
    );
    const ids = testIds.map((t) => t.replace(/^my-block-card-/, ""));
    expect(ids[0]).not.toBe(ids[1]);
    await closeMyBlocks(pageA);

    // --- Reload: the resolution is durable (no silent overwrite, no re-conflict) ---
    await pageA.reload();
    await expect(pageA.locator('[data-testid="editor-root"]')).toBeVisible({ timeout: 30000 });
    await expectStatusLabel(pageA, "Synced", 30000);
    await openMyBlocks(pageA);
    await expect(pageA.locator('[data-testid^="my-block-card-"]')).toHaveCount(2, {
      timeout: 10000,
    });
    await expect(pageA.locator('[data-testid="my-blocks-library"]')).toContainText("Shared Hero 2");
    await closeMyBlocks(pageA);

    // --- Device two syncs: it receives BOTH records ---
    await syncNow(pageB);
    await expectStatusLabel(pageB, "Synced", 30000);
    await openMyBlocks(pageB);
    await expect(pageB.locator('[data-testid^="my-block-card-"]')).toHaveCount(2, {
      timeout: 10000,
    });
    await expect(pageB.locator('[data-testid="my-blocks-library"]')).toContainText("Shared Hero");
    await expect(pageB.locator('[data-testid="my-blocks-library"]')).toContainText("Shared Hero 2");
    await closeMyBlocks(pageB);

    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });
});

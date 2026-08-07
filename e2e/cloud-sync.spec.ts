import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openEditor,
  openMyBlocks,
  closeMyBlocks,
  createBlockViaImport,
  blockIdOf,
  renameBlock,
  signUp,
  signIn,
  signOut,
  chooseInitialMerge,
  expectStatusLabel,
  syncNow,
  statusControl,
  uniqueSuffix,
  waitForCloudBlockName,
} from "./helpers/cloud-sync";

// ---------------------------------------------------------------------------
// Phase P6 — E2E: accounts + cross-device sync
//
// Uses the mock cloud backend (in-memory in the dev-server process), so two
// browser contexts are two "devices" sharing ONE cloud. Flow:
//   1. start local-only, create a My Block (no account)
//   2. sign up → initial merge (recommended) → synced
//   3. second device signs in → download library → block appears
//   4. rename on device two → device one syncs and sees it
//   5. offline local change on device one → reconnect → auto-sync succeeds
//   6. sign out → local data retained, status back to "Saved locally"
// ---------------------------------------------------------------------------

test.describe("Cloud sync — cross-device", () => {
  test("local-only → sign up → merge → cross-device sync → offline queue → sign out", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const email = `alice-${uniqueSuffix()}@example.com`;
    const password = "password123";

    // ----------------------------- Device A -----------------------------
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    const auditA = attachRuntimeAudit(pageA);

    // 1. Start local-only. No account yet.
    await openEditor(pageA);
    await expectStatusLabel(pageA, "Saved locally");

    // Save a piece while signed out (local-first).
    await createBlockViaImport(pageA, "Cloud Hero");

    // The signed-out library explains local-only mode (count-aware copy +
    // the backup CTA).
    await openMyBlocks(pageA);
    await expect(
      pageA.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Back them up and use them anywhere");
    await expect(
      pageA.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Cloud Hero");
    await closeMyBlocks(pageA);

    // 2. Sign up → initial merge (recommended) → sync.
    await signUp(pageA, email, password);
    await chooseInitialMerge(pageA, "Merge both");
    await expectStatusLabel(pageA, "Synced", 30000);

    // The library no longer shows the sign-up CTA once backed up (the
    // CloudSyncPrompt self-hides for signed-in users).
    await openMyBlocks(pageA);
    await expect(
      pageA.locator('[data-testid="my-blocks-library"]'),
    ).not.toContainText("Back them up and use them anywhere");
    await expect(
      pageA.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Cloud Hero");
    await closeMyBlocks(pageA);

    // ----------------------------- Device B -----------------------------
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    const auditB = attachRuntimeAudit(pageB);

    // Fresh device: empty library.
    await openEditor(pageB);
    await openMyBlocks(pageB);
    await expect(
      pageB.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("No saved blocks yet");
    await closeMyBlocks(pageB);

    // 3. Sign in on device two → download the cloud library.
    await signIn(pageB, email, password);
    await chooseInitialMerge(pageB, "Download cloud library");
    await expectStatusLabel(pageB, "Synced", 30000);

    await openMyBlocks(pageB);
    await expect(
      pageB.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Cloud Hero");
    await closeMyBlocks(pageB);

    // 4. Edit metadata on device two (rename) → device one sees it after sync.
    const blockIdB = await blockIdOf(pageB, "Cloud Hero");
    await renameBlock(pageB, blockIdB, "Cloud Hero v2");
    await expectStatusLabel(pageB, "Synced", 30000);
    // Wait on ACTUAL cloud content: the label is sticky "Synced", so it does
    // not prove the (debounced) rename upload has landed server-side yet.
    await waitForCloudBlockName(pageB, "Cloud Hero v2");

    await syncNow(pageA);
    // Wait on device A's LIBRARY CONTENT, not the sticky label.
    await openMyBlocks(pageA);
    await expect(
      pageA.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Cloud Hero v2", { timeout: 30000 });
    await closeMyBlocks(pageA);
    await expectStatusLabel(pageA, "Synced", 30000);

    // 5. Offline local change on device one → reconnect → sync succeeds.
    await contextA.setOffline(true);
    await expectStatusLabel(pageA, "Offline — changes saved here", 15000);

    const blockIdA = await blockIdOf(pageA, "Cloud Hero v2");
    await renameBlock(pageA, blockIdA, "Cloud Hero v3");

    await contextA.setOffline(false);
    await expectStatusLabel(pageA, "Synced", 30000);
    // Wait for the offline change to actually reach the cloud.
    await waitForCloudBlockName(pageA, "Cloud Hero v3");

    // Device two picks up the offline change.
    await syncNow(pageB);
    await openMyBlocks(pageB);
    await expect(
      pageB.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Cloud Hero v3", { timeout: 30000 });
    await closeMyBlocks(pageB);
    await expectStatusLabel(pageB, "Synced", 30000);

    // 6. Sign out keeps local data; status returns to "Saved locally".
    await signOut(pageA);
    await expectStatusLabel(pageA, "Saved locally", 10000);
    await openMyBlocks(pageA);
    await expect(
      pageA.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Cloud Hero v3");
    await closeMyBlocks(pageA);

    // No console / page / network errors on either device.
    assertRuntimeClean(auditA.state);
    assertRuntimeClean(auditB.state);

    await contextA.close();
    await contextB.close();
  });

  test("password reset, account menu, sync details, and account settings", async ({ browser }) => {
    test.setTimeout(120_000);
    const email = `bob-${uniqueSuffix()}@example.com`;
    const password = "password123";

    const context = await browser.newContext();
    const page = await context.newPage();
    const audit = attachRuntimeAudit(page);

    await openEditor(page);

    // Password reset (signed out): same friendly outcome whether or not the
    // account exists — no account-existence leakage.
    await statusControl(page).click();
    await page.getByRole("menuitem", { name: "Sign in to back up", exact: true }).click();
    await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
    const resetDialog = page.getByRole("dialog", { name: "Reset your password" });
    await expect(resetDialog).toBeVisible({ timeout: 5000 });
    await page.locator("#reset-email").fill(email);
    await resetDialog.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(resetDialog).toContainText("If an account exists for that email");
    await resetDialog.getByRole("button", { name: "Done", exact: true }).click();
    // Back in the auth dialog — close it.
    await page.getByRole("dialog", { name: /Welcome back|Create your account/ }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 5000 });

    // Sign up (no local pieces → no merge prompt, straight to synced).
    await signUp(page, email, password);
    await expectStatusLabel(page, "Synced", 30000);

    // Account menu shows the signed-in email.
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menu")).toContainText(email);

    // Sync details dialog.
    await statusControl(page).click();
    await page.getByRole("menuitem", { name: "View sync details", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Backup details" });
    await expect(details).toBeVisible({ timeout: 5000 });
    await expect(details).toContainText("Synced");
    await details.getByRole("button", { name: "Close", exact: true }).click();

    // Account & backup settings dialog.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Account & backup", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Account & backup" });
    await expect(settings).toBeVisible({ timeout: 5000 });
    await expect(settings).toContainText(email);
    await expect(settings).toContainText("Saved pieces on this device");
    await settings.getByRole("button", { name: "Close", exact: true }).click();

    // Sign out returns to local-only status.
    await signOut(page);
    await expectStatusLabel(page, "Saved locally", 10000);

    assertRuntimeClean(audit.state);
    await context.close();
  });
});

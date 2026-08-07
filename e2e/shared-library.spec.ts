import { test, expect } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import {
  openEditor,
  openMyBlocks,
  closeMyBlocks,
  createBlockViaImport,
  blockIdOf,
  signUp,
  chooseInitialMerge,
  expectStatusLabel,
  openSharedLibraries,
  uniqueSuffix,
} from "./helpers/cloud-sync";

// ---------------------------------------------------------------------------
// Phase P6 — E2E: private shared libraries
//
// Owner flow: create a private library → add a saved piece → invite a second
// user by email (in-app delivery — no email provider in P6). The invitee
// signs in, accepts, previews, copies the piece to their own My Blocks, and
// the copy is INDEPENDENT (fresh ids): the owner then removes the shared
// source and revokes access, and the copy + the invitee's library survive.
// ---------------------------------------------------------------------------

test.describe("Private shared libraries", () => {
  test("create → add piece → invite → copy → independence → revoke", async ({ browser }) => {
    test.setTimeout(240_000);
    const suffix = uniqueSuffix();
    const ownerEmail = `owner-${suffix}@example.com`;
    const guestEmail = `guest-${suffix}@example.com`;
    const password = "password123";

    // ----------------------------- Owner -----------------------------
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    const auditOwner = attachRuntimeAudit(owner);

    await openEditor(owner);
    await createBlockViaImport(owner, "Shared Hero");
    await signUp(owner, ownerEmail, password);
    await chooseInitialMerge(owner, "Merge both");
    await expectStatusLabel(owner, "Synced", 30000);

    // Capture the block id now — the add-pieces dialog overlays the TopNav.
    const heroId = await blockIdOf(owner, "Shared Hero");

    // Create the private library.
    await openSharedLibraries(owner);
    const panel = owner.getByRole("dialog", { name: "Shared libraries" });
    await panel.getByRole("button", { name: "New", exact: true }).click();
    const create = owner.getByRole("dialog", { name: "New shared library" });
    await expect(create).toBeVisible({ timeout: 5000 });
    await owner.locator("#library-name").fill("Team Kit");
    await create.getByRole("button", { name: "Create library", exact: true }).click();
    await expect(create).toBeHidden({ timeout: 10000 });

    // Add a piece from My Blocks.
    const ownerCard = owner.locator('[data-testid="shared-library-card"]').filter({ hasText: "Team Kit" });
    await expect(ownerCard).toBeVisible({ timeout: 10000 });
    await expect(ownerCard).toContainText("0 pieces");
    await ownerCard.getByRole("button", { name: "Open", exact: true }).click();
    const ownerDetails = owner.getByRole("dialog", { name: "Team Kit" });
    await expect(ownerDetails).toBeVisible({ timeout: 10000 });
    await expect(ownerDetails).toContainText("Your permission: Owner");
    await owner.locator('[data-testid="library-add-pieces"]').click();
    const addDialog = owner.getByRole("dialog", { name: "Add saved pieces" });
    await expect(addDialog).toBeVisible({ timeout: 5000 });
    await owner.locator(`[data-testid="add-blocks-block-${heroId}"]`).check();
    await owner.locator('[data-testid="add-blocks-submit"]').click();
    await expect(addDialog).toBeHidden({ timeout: 10000 });
    await expect(ownerDetails).toContainText("Shared Hero", { timeout: 10000 });
    await ownerDetails.getByRole("button", { name: "Close", exact: true }).click();
    await expect(ownerCard).toContainText("1 piece", { timeout: 10000 });

    // Invite the guest (viewer).
    await ownerCard.getByRole("button", { name: "Manage members", exact: true }).click();
    const manage = owner.getByRole("dialog", { name: "Manage members" });
    await expect(manage).toBeVisible({ timeout: 10000 });
    await manage.getByRole("button", { name: "Invite someone", exact: true }).click();
    const invite = owner.getByRole("dialog", { name: "Invite someone" });
    await expect(invite).toBeVisible({ timeout: 5000 });
    await owner.locator("#invite-email").fill(guestEmail);
    await invite.getByRole("button", { name: "Send invitation", exact: true }).click();
    await expect(invite).toContainText("Invitation sent", { timeout: 10000 });
    await invite.getByRole("button", { name: "Done", exact: true }).click();
    await expect(manage).toContainText(guestEmail, { timeout: 10000 });
    await manage.getByRole("button", { name: "Close", exact: true }).click();
    await panel.getByRole("button", { name: "Close", exact: true }).click();

    // ----------------------------- Guest -----------------------------
    const guestContext = await browser.newContext();
    const guest = await guestContext.newPage();
    const auditGuest = attachRuntimeAudit(guest);

    await openEditor(guest);
    await signUp(guest, guestEmail, password);
    await expectStatusLabel(guest, "Synced", 30000);

    // Accept the in-app invitation.
    await openSharedLibraries(guest);
    const guestPanel = guest.getByRole("dialog", { name: "Shared libraries" });
    await expect(guestPanel).toContainText("Invitations for you", { timeout: 10000 });
    const inviteRow = guest.locator('[data-testid="invitation-row"]');
    await expect(inviteRow).toContainText("Team Kit");
    await inviteRow.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(inviteRow).toHaveCount(0, { timeout: 10000 });
    const guestCard = guest.locator('[data-testid="shared-library-card"]').filter({ hasText: "Team Kit" });
    await expect(guestCard).toBeVisible({ timeout: 10000 });
    await expect(guestCard).toContainText("Can view");
    await expect(guestCard).toContainText("1 piece");

    // Preview + copy to My Blocks.
    await guestCard.getByRole("button", { name: "Open", exact: true }).click();
    const guestDetails = guest.getByRole("dialog", { name: "Team Kit" });
    await expect(guestDetails).toBeVisible({ timeout: 10000 });
    await expect(guestDetails).toContainText("Your permission: Can view");
    await expect(guestDetails).toContainText("Shared Hero");
    await guestDetails.getByRole("button", { name: "Copy to My Blocks", exact: true }).click();
    await expect(guest.locator('[data-testid="my-blocks-toast"]')).toContainText(
      "Copied to your saved pieces.",
      { timeout: 10000 },
    );
    await guestDetails.getByRole("button", { name: "Close", exact: true }).click();
    await guestPanel.getByRole("button", { name: "Close", exact: true }).click();

    // The copy is now an independent personal block.
    await openMyBlocks(guest);
    await expect(
      guest.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Shared Hero");
    await closeMyBlocks(guest);

    // --- Independence: owner removes the shared source ---
    await openSharedLibraries(owner);
    await owner
      .locator('[data-testid="shared-library-card"]')
      .filter({ hasText: "Team Kit" })
      .getByRole("button", { name: "Open", exact: true })
      .click();
    const removeButton = owner.locator('[data-testid^="library-remove-block-"]');
    await expect(removeButton).toHaveCount(1, { timeout: 10000 });
    await removeButton.click();
    await expect(owner.getByRole("dialog", { name: "Team Kit" })).toContainText(
      "No pieces here yet",
      { timeout: 10000 },
    );
    await owner.getByRole("dialog", { name: "Team Kit" }).getByRole("button", { name: "Close", exact: true }).click();
    // Close the panel too — otherwise it stays open and blocks the next
    // Account-menu click later in this test.
    await owner.getByRole("dialog", { name: "Shared libraries" }).getByRole("button", { name: "Close", exact: true }).click();

    // The guest's copied block is untouched.
    await openMyBlocks(guest);
    await expect(
      guest.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Shared Hero");
    await closeMyBlocks(guest);

    // --- Revocation: owner revokes the guest ---
    await openSharedLibraries(owner);
    await owner
      .locator('[data-testid="shared-library-card"]')
      .filter({ hasText: "Team Kit" })
      .getByRole("button", { name: "Manage members", exact: true })
      .click();
    const manageDialog = owner.getByRole("dialog", { name: "Manage members" });
    await expect(manageDialog).toContainText(guestEmail, { timeout: 10000 });
    // Exactly one member row exists (the guest) — its Revoke button is unique.
    const revoke = manageDialog.getByRole("button", { name: "Revoke", exact: true });
    await revoke.click();
    await expect(manageDialog).not.toContainText(guestEmail, { timeout: 10000 });
    await owner.getByRole("dialog", { name: "Manage members" }).getByRole("button", { name: "Close", exact: true }).click();
    await owner.getByRole("dialog", { name: "Shared libraries" }).getByRole("button", { name: "Close", exact: true }).click();

    // The guest loses access online: the library leaves "Shared with me".
    await openSharedLibraries(guest);
    const guestPanelAfter = guest.getByRole("dialog", { name: "Shared libraries" });
    await expect(guestPanelAfter).toContainText("Nothing shared with you yet.", {
      timeout: 10000,
    });
    await expect(guestPanelAfter.locator('[data-testid="shared-library-card"]')).toHaveCount(0);
    await guestPanelAfter.getByRole("button", { name: "Close", exact: true }).click();

    // The guest's personal copy remains independent.
    await openMyBlocks(guest);
    await expect(
      guest.locator('[data-testid="my-blocks-library"]'),
    ).toContainText("Shared Hero");
    await closeMyBlocks(guest);

    assertRuntimeClean(auditOwner.state);
    assertRuntimeClean(auditGuest.state);

    await ownerContext.close();
    await guestContext.close();
  });
});

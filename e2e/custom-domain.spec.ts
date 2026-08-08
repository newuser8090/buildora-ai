import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import {
  createSignedInProjectAndOpenEditor,
  openLaunchCenter,
  publishViaVercel,
  closePublishDialog,
  openHistoryFromPublishDialog,
  openDeploymentDetails,
} from "./helpers/publishing";

// ---------------------------------------------------------------------------
// Phase P8 — E2E: custom domains (Vercel provider, mock mode)
//
// The domain flow requires a live Vercel deployment first, so this test
// publishes then connects a domain. The MockVercelServer auto-verifies DNS
// after a short delay (DNS propagation simulation), so the test observes the
// full lifecycle: pending → instructions shown → verified → connected.
//   1. create project + sign up
//   2. publish via Vercel (needed before a domain can attach)
//   3. open the domain dialog from deployment details
//   4. attach a unique domain → pending card + beginner DNS instructions
//   5. "Check again" / auto-poll → verified → success banner
//   6. verified domain exposes open/copy actions
//   7. no console/page/network errors
// ---------------------------------------------------------------------------

test.describe("Phase P8 — custom domains (Vercel)", () => {
  test("publish, connect a domain, and see it verified", async ({ page }) => {
    test.setTimeout(300_000);
    const audit = attachRuntimeAudit(page);

    // 1. Project + signed-in session.
    await createSignedInProjectAndOpenEditor(page);

    // 2. Live Vercel deployment (required before a domain can attach).
    await publishViaVercel(page);
    await closePublishDialog(page);

    // 3. Open the domain dialog via deployment details → Manage domain.
    await openLaunchCenter(page);
    await page.locator('[data-testid="launch-publish"]').click();
    await openHistoryFromPublishDialog(page);
    await openDeploymentDetails(page);
    const details = page.getByRole("dialog", { name: "Deployment details" });
    await details.locator('[data-testid="details-manage-domain"]').click();

    const domainDialog = page.getByRole("dialog", { name: "Connect your own domain" });
    await expect(domainDialog).toBeVisible({ timeout: 5000 });

    // 4. Attach a unique domain (valid hostname; the mock rejects duplicates).
    const domain = `buildora-e2e-${Date.now().toString(36)}.com`;
    await page.locator('[data-testid="domain-input"]').fill(domain);
    await page.locator('[data-testid="domain-attach"]').click();

    // Pending card + beginner DNS instructions appear.
    await expect(page.locator('[data-testid="domain-card-' + domain + '"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="domain-instructions"]')).toBeVisible();
    await expect(page.locator('[data-testid="domain-instructions"]')).toContainText(
      "Open the place where you bought",
    );
    await expect(page.locator('[data-testid="domain-instructions"]')).toContainText(
      "CNAME",
    );
    await expect(page.locator('[data-testid="domain-instructions"]')).toContainText(
      "cname.vercel-dns.com.",
    );
    // Pending state is explicit (never claims verification before it happens).
    await expect(page.locator('[data-testid="domain-card-' + domain + '"]')).toContainText(
      "Still connecting",
    );

    // 5. The mock provider auto-verifies DNS after a short delay; the dialog
    // auto-polls while pending. Wait for the connected state.
    await expect(page.locator('[data-testid="domain-success"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="domain-success"]')).toContainText(
      "Your domain is connected.",
    );
    await expect(
      page.locator('[data-testid="domain-card-' + domain + '"]'),
    ).toContainText("Connected");

    // 6. The verified domain exposes open + copy actions.
    await expect(
      page.locator('[data-testid="domain-open-' + domain + '"]'),
    ).toHaveAttribute("href", `https://${domain}`);
    await expect(
      page.locator('[data-testid="domain-copy-' + domain + '"]'),
    ).toBeVisible();

    // 7. No console / page / network errors.
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

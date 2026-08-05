import { test, expect } from "@playwright/test";
import {
  attachRuntimeAudit,
  assertRuntimeClean,
} from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P3 — E2E: security removal
//
// Paste JSX containing:
//   - a safe heading + button
//   - onClick handler
//   - a <script> tag
//   - a javascript: href
//   - an unresolved custom component
//
// Verify:
//   - unsafe behavior is listed under "Removed for safety"
//   - supported parts are previewed
//   - supported-parts conversion is allowed
//   - NOTHING executes (no dialogs, no page errors, no network to evil.com)
//   - the inserted result contains only safe native blocks
//   - save/reload works
//   - export contains no unsafe code
//   - no console/page/network errors
// ---------------------------------------------------------------------------

const UNSAFE_JSX = `<div className="hero">
  <h1>Safe heading</h1>
  <button onClick={() => alert("BOOM")}>Safe button</button>
  <a href="javascript:alert(1)">Unsafe link</a>
  <script>document.title = "pwned"</script>
  <FancyChart data={[1,2,3]} />
</div>`;

test.describe("Code import — security removal", () => {
  test("unsafe behaviour removed, supported parts converted, nothing executes", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);

    // Track any requests to the example 'evil' host that must never fire.
    const unsafeRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("evil.com")) unsafeRequests.push(req.url());
    });

    await createSaaSProjectAndOpenEditor(page);

    // Open the Import Studio from the Blocks tab.
    await page.locator('[data-testid="right-tab-blocks"]').click();
    await page.locator('[data-testid="build-tree-import-code"]').click();
    await expect(page.locator('[data-testid="code-import-dialog"]')).toBeVisible();

    await page.locator('[data-testid="code-import-source"]').fill(UNSAFE_JSX);
    await page.locator('[data-testid="code-import-analyse"]').click();

    // Analysis completes; safe parts were converted (summary shown).
    await expect(page.locator('[data-testid="analysis-result"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("We found")).toBeVisible();

    // Review step lists the removed-for-safety findings and previews the
    // converted content (the actual "Safe heading" text appears in the
    // visual preview here, not in the analysis summary).
    await page.locator('[data-testid="analysis-continue"]').click();
    await expect(page.locator('[data-testid="review-step"]')).toBeVisible();
    // The "Removed for safety" bucket is present (scoped by testid — plain
    // getByText would also match warning item copy that ends in the same
    // phrase). The converted content is previewed next to it.
    await expect(page.locator('[data-testid="warning-group-removed"]')).toBeVisible();
    await expect(page.getByText(/Safe heading/)).toBeVisible();

    // Supported-parts conversion is offered and selectable.
    await expect(page.locator('[data-testid="mode-supported-only"]')).toBeVisible();
    await page.locator('[data-testid="mode-supported-only"]').click();
    expect(await page.locator('[data-testid="mode-supported-only"]').isVisible()).toBe(
      true,
    );

    // Nothing executed: no page errors, no evil.com network calls.
    expect(unsafeRequests).toEqual([]);
    expect(audit.state.pageErrors).toEqual([]);

    // Place and insert.
    await page.locator('[data-testid="review-continue"]').click();
    await expect(page.locator('[data-testid="placement-step"]')).toBeVisible();
    await page.locator('[data-testid="insert-button"]').click();
    await expect(page.locator('[data-testid="import-success"]')).toBeVisible({
      timeout: 5000,
    });

    // Close the success dialog — its backdrop intercepts pointer events on
    // the page behind it (needed for the Save click later).
    await page.locator('[data-testid="success-edit-now"]').click();

    // The inserted result contains only safe native blocks.
    const preview = page.locator('[data-testid="preview-content"]');
    await expect(preview.getByText("Safe heading")).toBeVisible({ timeout: 5000 });
    await expect(preview.getByText("Safe button")).toBeVisible({ timeout: 5000 });
    // The unsafe link text exists as a safe placeholder (no javascript: href).
    await expect(preview.getByText("Unsafe link")).toBeVisible({ timeout: 5000 });
    const unsafeHrefCount = await page
      .locator('[data-testid="preview-content"] a[href^="javascript:"]')
      .count();
    expect(unsafeHrefCount).toBe(0);

    // Save/reload — the safe result persists. Autosave runs on a 3s
    // debounce, so force a save first so the reload provably reads
    // persisted state.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await page.reload();
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.locator('[data-testid="preview-content"]').getByText("Safe heading"),
    ).toBeVisible({ timeout: 10000 });

    // Export — the generated site contains no unsafe code.
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.locator('[data-testid="export-button"]').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let body = "";
    if (stream) {
      for await (const chunk of stream) {
        body += chunk.toString();
      }
    }
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("onClick");
    expect(body).not.toContain("FancyChart");
    expect(body).toContain("Safe heading");

    // Still nothing executed after reload + export.
    expect(unsafeRequests).toEqual([]);
    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

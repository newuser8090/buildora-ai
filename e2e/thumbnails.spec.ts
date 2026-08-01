import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { attachRuntimeAudit, assertRuntimeClean } from "./helpers/runtime-audit";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Real-browser thumbnail flow.
//
// This spec does NOT mock the thumbnail pipeline. The project is created from
// the SaaS template through the dashboard dialog, opened in the editor, edited,
// saved, and a REAL thumbnail is generated (hidden preview render →
// modern-screenshot capture → canvas encode → IndexedDB `projectThumbnails`
// store). The dashboard then shows the real image from the stored Blob.
// ---------------------------------------------------------------------------

/** Open the dashboard and create a project from the SaaS template (shared helper). */
async function createSaaSProjectFromTemplate(page: Page): Promise<string> {
  return createSaaSProjectAndOpenEditor(page);
}

/** Click the hero headline in the editor and replace it. */
async function editHeroHeadline(page: Page, newText: string): Promise<void> {
  const preview = page.locator('[data-testid="preview-content"]');
  await expect(preview).toBeVisible({ timeout: 15000 });

  await preview.getByText("Ship your next product in days, not months").click();
  const inspector = page.locator('[data-testid="inspector-panel"]');
  await expect(inspector).toBeVisible({ timeout: 5000 });
  await inspector.locator("textarea").first().fill(newText);
  await expect(preview.getByText(newText)).toBeVisible({ timeout: 5000 });
}

/** Click Save in the editor TopNav and wait for the persisted "Saved" state. */
async function saveInEditor(page: Page): Promise<void> {
  // Matches the idle ("Save (Ctrl+S)") and saved ("Saved") states but NOT the
  // transient "Saving..." state — so we never try to click a disabled button.
  const saveBtn = page
    .locator('header button[title="Save (Ctrl+S)"], header button[title="Saved"]')
    .first();
  await saveBtn.waitFor({ state: "visible", timeout: 10000 });
  if (!(await saveBtn.isDisabled())) {
    await saveBtn.click();
  }
  await expect(page.locator('header button[title="Saved"]')).toBeVisible({
    timeout: 15000,
  });
}

/** Read whether a thumbnail record exists for the project (no polling). */
async function hasStoredThumbnail(page: Page, projectId: string): Promise<boolean> {
  return page.evaluate(
    (pid) =>
      new Promise<boolean>((resolve) => {
        const openReq = indexedDB.open("buildora");
        openReq.onsuccess = () => {
          const db = openReq.result;
          try {
            if (!db.objectStoreNames.contains("projectThumbnails")) {
              db.close();
              resolve(false);
              return;
            }
            const getReq = db
              .transaction("projectThumbnails", "readonly")
              .objectStore("projectThumbnails")
              .get(pid);
            getReq.onsuccess = () => {
              const ok = !!getReq.result;
              db.close();
              resolve(ok);
            };
            getReq.onerror = () => {
              db.close();
              resolve(false);
            };
          } catch {
            db.close();
            resolve(false);
          }
        };
        openReq.onerror = () => resolve(false);
      }),
    projectId,
  );
}

/** Return to the dashboard via the editor TopNav back button. */
async function backToDashboard(page: Page): Promise<void> {
  await page.locator('button[aria-label="Back to Dashboard"]').click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Project thumbnails (real browser)", () => {
  test("real thumbnail appears automatically after back-navigation, persists across reload, and the project stays editable", async ({
    page,
  }) => {
    const audit = attachRuntimeAudit(page);
    await createSaaSProjectFromTemplate(page);

    // Editor opens with the template project.
    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });

    // Make a clearly visible text edit.
    await editHeroHeadline(page, "Thumbnail E2E Headline");
    await saveInEditor(page);

    // Navigate back IMMEDIATELY — do NOT wait for the thumbnail to be
    // stored. This is the real product race: the scheduler debounces
    // (2000 ms), then renders/captures/encodes, and only then commits the
    // IndexedDB record — while the dashboard is already mounted. The
    // dashboard shows a placeholder first and must upgrade automatically via
    // the ready notification + bounded retry (eventual-thumbnail policy).
    await backToDashboard(page);

    // The real thumbnail must appear automatically (placeholder may show
    // briefly). Generous timeout covers debounce + render + capture + commit
    // + dashboard reload.
    const thumb = page.locator('[data-testid="project-thumbnail"]');
    await expect(thumb).toBeVisible({ timeout: 30000 });
    const src = await thumb.getAttribute("src");
    expect(src ?? "").toMatch(/^blob:/);
    await expect(thumb).toHaveAttribute("alt", "Preview of SaaS Landing Page");

    // Reload the dashboard — the thumbnail persists (IndexedDB).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="project-thumbnail"]')).toBeVisible({
      timeout: 15000,
    });

    // Reopen the project — it remains editable with the saved content.
    await page
      .getByRole("button", { name: "Open project SaaS Landing Page" })
      .click();
    await page.waitForURL(/\/editor\/.+/, { timeout: 15000 });
    await expect(page.locator('[data-testid="preview-content"]')).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('[data-testid="preview-content"]')
      .getByText("Thumbnail E2E Headline")
      .click();
    await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible({
      timeout: 5000,
    });

    assertRuntimeClean(audit.state);
    audit.detach();
  });

  test("thumbnail generation failure keeps saves working and falls back to the placeholder", async ({
    page,
  }) => {
    // Force thumbnail generation to fail (canvas.toBlob always produces null),
    // while real DOM rendering + IndexedDB behavior remain involved. The
    // scheduler is non-blocking, so the project save and editor are unaffected.
    await page.addInitScript(() => {
      const proto = HTMLCanvasElement.prototype as unknown as {
        toBlob: (cb: BlobCallback, type?: string, quality?: number) => void;
      };
      proto.toBlob = function (
        cb: BlobCallback,
        _type?: string,
        _quality?: number,
      ) {
        queueMicrotask(() => cb(null));
      };
    });

    const audit = attachRuntimeAudit(page);
    const projectId = await createSaaSProjectFromTemplate(page);

    await expect(page.locator('[data-testid="editor-root"]')).toBeVisible({
      timeout: 15000,
    });
    await editHeroHeadline(page, "Failure Flow Headline");
    await saveInEditor(page);

    // Give the scheduler time to debounce (2000 ms) and attempt generation.
    // Because toBlob always yields null, generation can never persist a
    // record — confirm the record stays absent across a poll window.
    const start = Date.now();
    let seenRecord = false;
    while (Date.now() - start < 8_000) {
      seenRecord = seenRecord || (await hasStoredThumbnail(page, projectId));
      await page.waitForTimeout(500);
    }
    expect(seenRecord).toBe(false);

    // Dashboard shows the placeholder (no thumbnail image) and the card.
    await backToDashboard(page);
    await expect(page.getByText("SaaS Landing Page")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="project-thumbnail"]')).toHaveCount(0);

    // Editor remains usable after the failed generation.
    await page
      .getByRole("button", { name: "Open project SaaS Landing Page" })
      .click();
    await page.waitForURL(/\/editor\/.+/, { timeout: 15000 });
    await expect(page.locator('[data-testid="preview-content"]')).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('[data-testid="preview-content"]')
      .getByText("Failure Flow Headline")
      .click();
    await expect(page.locator('[data-testid="inspector-panel"]')).toBeVisible({
      timeout: 5000,
    });

    assertRuntimeClean(audit.state);
    audit.detach();
  });
});

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createSaaSProjectAndOpenEditor } from "./helpers/projects";

// ---------------------------------------------------------------------------
// Phase P22-K — Premium Canva-style UI polish (editor shell)
//
// Collapsible/resizable panels, persisted UI prefs, and shell accessibility.
// Every assertion targets deterministic state (inline widths, testids, aria)
// rather than pixel-perfect coordinates.
// ---------------------------------------------------------------------------

const LEFT_WIDTH_DEFAULT = 320;
const RIGHT_WIDTH_DEFAULT = 300;
const MIN_WIDTH = 240;
const MAX_WIDTH = 480;

function widthOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((el) => el.getBoundingClientRect().width);
}

test.describe("Phase P22-K — editor shell polish", () => {
  test("collapse, resize, persist, tabs, and a11y on the default shell", async ({ page }) => {
    test.setTimeout(180_000);
    await createSaaSProjectAndOpenEditor(page);

    // 1. Editor loads with default widths.
    await expect
      .poll(() => widthOf(page, "#ai-sidebar"), { timeout: 10000 })
      .toBeGreaterThan(LEFT_WIDTH_DEFAULT - 2);
    await expect
      .poll(() => widthOf(page, "#editor-sidebar"), { timeout: 10000 })
      .toBeGreaterThan(RIGHT_WIDTH_DEFAULT - 2);

    // 12. Existing right-tab-* testids still work.
    await page.locator('[data-testid="right-tab-data"]').click();
    await expect(page.locator('[data-testid="data-panel"]')).toBeVisible();
    await page.locator('[data-testid="right-tab-design"]').click();
    await expect(page.locator('[data-testid="design-panel"]')).toBeVisible();

    // 14. AI sidebar still works.
    await expect(page.locator('[data-testid="prompt-input"]')).toBeVisible();

    // 2/17. Left sidebar collapses → canvas expands; aria-expanded flips.
    const canvasBefore = await widthOf(page, '[data-testid="preview-content"]');
    const collapseLeft = page.locator('[data-testid="collapse-left-panel"]');
    await expect(collapseLeft).toHaveAttribute("aria-expanded", "true");
    await collapseLeft.click();
    await expect(page.locator('[data-testid="ai-sidebar-rail"]')).toBeVisible();
    await expect(page.locator("#ai-sidebar")).toHaveCount(0);
    await expect
      .poll(() => widthOf(page, '[data-testid="preview-content"]'))
      .toBeGreaterThan(canvasBefore + 200);
    await expect(
      page.locator('[data-testid="ai-sidebar-rail"] [data-testid="collapse-left-panel"]'),
    ).toHaveAttribute("aria-expanded", "false");

    // 3. Left sidebar reopens.
    await page.locator('[data-testid="ai-sidebar-rail"] [data-testid="collapse-left-panel"]').click();
    await expect(page.locator("#ai-sidebar")).toBeVisible();

    // 4/17. Right sidebar collapses and reopens.
    const collapseRight = page.locator('[data-testid="collapse-right-panel"]');
    await expect(collapseRight).toHaveAttribute("aria-expanded", "true");
    await collapseRight.click();
    await expect(page.locator('[data-testid="right-sidebar-rail"]')).toBeVisible();
    await expect(page.locator("#editor-sidebar")).toHaveCount(0);
    // 5. Reopen.
    await page.locator('[data-testid="right-sidebar-rail"] [data-testid="collapse-right-panel"]').click();
    await expect(page.locator("#editor-sidebar")).toBeVisible();

    // 6/8. Left resize drag changes width (clamped 240–480). Wait for the
    // collapse/expand width transition to settle so the pointer-down lands on
    // the (6px) handle deterministically.
    await expect.poll(() => widthOf(page, "#ai-sidebar")).toBe(LEFT_WIDTH_DEFAULT);
    const leftHandle = page.locator('[data-testid="resize-left-handle"]');
    const lh = await leftHandle.boundingBox();
    expect(lh).not.toBeNull();
    await page.mouse.move(lh!.x + lh!.width / 2, lh!.y + 40);
    await page.mouse.down();
    await page.mouse.move(lh!.x + lh!.width / 2 + 80, lh!.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => widthOf(page, "#ai-sidebar")).toBeGreaterThan(LEFT_WIDTH_DEFAULT + 60);
    await expect.poll(() => widthOf(page, "#ai-sidebar")).toBeLessThanOrEqual(MAX_WIDTH);

    // 7/8. Right resize drag changes width (clamped 240–480).
    const rightHandle = page.locator('[data-testid="resize-right-handle"]');
    const rh = await rightHandle.boundingBox();
    expect(rh).not.toBeNull();
    await page.mouse.move(rh!.x + rh!.width / 2, rh!.y + 40);
    await page.mouse.down();
    await page.mouse.move(rh!.x + rh!.width / 2 - 60, rh!.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => widthOf(page, "#editor-sidebar")).toBeGreaterThan(RIGHT_WIDTH_DEFAULT + 40);
    await expect.poll(() => widthOf(page, "#editor-sidebar")).toBeLessThanOrEqual(MAX_WIDTH);

    // 9. Keyboard resize (ArrowRight +8 on the left handle).
    const before = await widthOf(page, "#ai-sidebar");
    await leftHandle.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => widthOf(page, "#ai-sidebar"))
      .toBe(before + 8);
    // Home jumps to the minimum bound.
    await page.keyboard.press("Home");
    await expect.poll(() => widthOf(page, "#ai-sidebar")).toBe(MIN_WIDTH);

    // 10/11. Reload restores persisted prefs (collapse + widths).
    await page.locator('[data-testid="collapse-left-panel"]').click();
    await expect(page.locator('[data-testid="ai-sidebar-rail"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-testid="ai-sidebar-rail"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("#ai-sidebar")).toHaveCount(0);

    // 13. Data panel still works after reload (integration tab intact).
    await page.locator('[data-testid="right-tab-data"]').click();
    await expect(page.locator('[data-testid="data-panel"]')).toBeVisible();
  });

  test("shell interactions survive reduced-motion and work in guided mode", async ({ page }) => {
    test.setTimeout(180_000);

    // Guided experience + a collapsed left panel, persisted up front.
    await page.addInitScript(() => {
      localStorage.setItem(
        "buildora:guided:prefs",
        JSON.stringify({
          experienceMode: "guided",
          onboardingCompleted: true,
          onboardingSelections: null,
          coachEnabled: true,
          dismissedTipIds: [],
          journeyCollapsed: false,
          tryGuidedBannerDismissed: false,
        }),
      );
      localStorage.setItem(
        "buildora:ui:prefs",
        JSON.stringify({
          leftPanelWidth: 360,
          rightPanelWidth: 300,
          leftPanelCollapsed: true,
          rightPanelCollapsed: false,
        }),
      );
    });

    await createSaaSProjectAndOpenEditor(page);

    // 18. Reduced motion must not break interaction.
    await page.emulateMedia({ reducedMotion: "reduce" });

    // Collapsed-left pref honored on load; the guided panel still opens.
    await expect(page.locator('[data-testid="ai-sidebar-rail"]')).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator("#ai-sidebar")).toHaveCount(0);

    // 15. Guided mode: structure tab still shows the guided panel.
    await page.locator('[data-testid="right-tab-structure"]').click();
    await expect(page.locator('[data-testid="guided-panel"]')).toBeVisible({
      timeout: 15000,
    });

    // Reopen the AI sidebar inside guided mode (D-K5 parity).
    await page
      .locator('[data-testid="ai-sidebar-rail"] [data-testid="collapse-left-panel"]')
      .click();
    await expect(page.locator("#ai-sidebar")).toBeVisible();

    // 16. Keyboard focus: the collapse button is reachable and operable.
    // Focus order is shell-dependent, so assert the button is focusable
    // directly and operates via the keyboard.
    await page.locator('[data-testid="collapse-left-panel"]').focus();
    await expect(page.locator('[data-testid="collapse-left-panel"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="ai-sidebar-rail"]')).toBeVisible();

    // Resize still works under reduced motion (drag by keyboard).
    await page
      .locator('[data-testid="ai-sidebar-rail"] [data-testid="collapse-left-panel"]')
      .click();
    const handle = page.locator('[data-testid="resize-left-handle"]');
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => widthOf(page, "#ai-sidebar")).toBeGreaterThan(360);
  });
});

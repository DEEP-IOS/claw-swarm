import { test, expect } from '@playwright/test';

test.describe('Console visual regression', () => {
  async function dismissOnboarding(page) {
    const skip = page.getByRole('button', { name: /Skip \/ 跳过/i });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
  }

  test('empty state guidance remains stable', async ({ page }) => {
    await page.goto('/v6/console/', { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page).toHaveScreenshot('console-empty-state.png', { fullPage: true });
  });

  test('settings drawer visual baseline in demo mode', async ({ page }) => {
    await page.goto('/v6/console/?demo=1', { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('Control+,');
    await expect(page).toHaveScreenshot('console-settings-drawer.png', { fullPage: true });
  });
});

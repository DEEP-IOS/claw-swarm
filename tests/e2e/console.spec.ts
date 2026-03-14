import { test, expect } from '@playwright/test';

test.describe('Console e2e', () => {
  async function dismissOnboarding(page) {
    const skip = page.getByRole('button', { name: /Skip \/ 跳过/i });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
  }

  test('renders all primary navigation views in demo mode', async ({ page }) => {
    await page.goto('/v6/console/?demo=1', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);

    await expect(page.locator('.view-tab')).toHaveCount(6);
    await expect(page.getByText('EVENT TIMELINE')).toHaveCount(1);
  });

  test('supports opening settings drawer from header', async ({ page }) => {
    await page.goto('/v6/console/?demo=1', { waitUntil: 'networkidle' });
    await dismissOnboarding(page);
    await page.keyboard.press('Control+,');
    await expect(page.getByText('Animation Speed')).toHaveCount(1);
    await expect(page.getByText('Label Language')).toHaveCount(1);
  });
});

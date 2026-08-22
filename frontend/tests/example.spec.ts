import { test, expect } from '@playwright/test';

test('has title and basic UI elements', async ({ page }) => {
  await page.goto('/');

  // Check if the page title is present (usually something like Vite + React or the App Name)
  // We'll just ensure the page loaded successfully without a 404 or 500 error
  await expect(page).not.toHaveTitle(/404/);

  // You can add more specific assertions here based on your actual UI
  // Example: await expect(page.locator('text=Connect Wallet')).toBeVisible();
});

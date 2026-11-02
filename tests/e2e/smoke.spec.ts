import { expect, test } from '@playwright/test';

test('the brief compiles through the lexer and shows its tokens', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('lexer-stats')).toContainText('35 characters became 7 tokens');
  await expect(page.locator('[data-stage="lexer"]')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('token-chip')).toHaveCount(7);
});

test('clicking a chip plays the automaton trace', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('token-chip').nth(3).click();
  await expect(page.getByTestId('dfa-summary')).toContainText('this is a NUMBER (30)');
});

test('a lexical error stops the pipeline at stage 1', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('error-L107-bad-time');
  await expect(page.locator('[data-stage="lexer"]')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('stopped-box')).toContainText('Stopped at stage 1: Lexer');
});

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

test('the parser card toggles trees and steps through the grammar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-stage="parser"]')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('program-text')).toContainText('TURN_ON AC');
  await page.getByTestId('parse-tree-toggle').click();
  await expect(page.locator('.tree-node', { hasText: 'andCond' }).first()).toBeVisible();
  await page.getByTestId('grammar-step').click();
  await expect(page.locator('.grammar-rule.is-active')).toHaveCount(1);
});

test('a syntax error shows the caret and greys later stages', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('error-P203-unbalanced-paren');
  await expect(page.getByTestId('stopped-box')).toContainText('Stopped at stage 2: Parser');
  await expect(page.locator('[data-card="parser"] .caret')).toHaveText('^');
  await expect(page.locator('[data-stage="semantic"]')).toHaveAttribute('data-status', 'skipped');
});

test('collect-all reports several syntax errors', async ({ page }) => {
  await page.goto('/');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('IF TRUE TURN_ON AC; IF TRUE THEN TURN ON AC;');
  await expect(page.locator('[data-card="parser"] .error-box')).toHaveCount(1);
  await page.getByTestId('collect-all').check();
  await expect(page.locator('[data-card="parser"] .diagnostic')).toHaveCount(1);
});

test('typing fast never freezes the page', async ({ page }) => {
  await page.goto('/');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  // Faster than the debounce. An editor that mirrors its own value back in
  // ping-pongs between old and new text and locks the tab here.
  await page.keyboard.type('IF TEMPERATURE > 40 THEN TURN_OFF AC');
  await expect(page.getByTestId('char-count')).toHaveText('36 characters');
  await expect(page.locator('.cm-content')).toHaveText('IF TEMPERATURE > 40 THEN TURN_OFF AC');
  await expect(page.locator('[data-stage="parser"]')).toHaveAttribute('data-status', 'ok');
});

test('loading a preset after typing replaces the text', async ({ page }) => {
  await page.goto('/');
  await page.locator('.cm-content').click();
  await page.keyboard.type('xyz');
  await page.getByTestId('preset-select').selectOption('cascade');
  await expect(page.locator('.cm-content')).toContainText('WHEN MOTION DETECTED');
});

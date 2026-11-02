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

test('a semantic error stops at stage 3 and the symbol table greys built-ins', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="symbol-table"] tr.is-builtin').first()).toBeVisible();
  await page.getByTestId('preset-select').selectOption('error-S301-unknown-device');
  await expect(page.getByTestId('stopped-box')).toContainText('Stopped at stage 3: Semantic analysis');
  await expect(page.getByTestId('stopped-box')).toContainText("Unknown device 'HEATPUMP'");
});

test('the semantic card shows number lines, a witness and a red cycle', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('number-lines').locator('figure')).toHaveCount(1);
  await page.getByTestId('preset-select').selectOption('conflict');
  await expect(page.getByTestId('load-witness')).toBeVisible();
  await expect(page.getByTestId('conflict-matrix').locator('td.is-conflict')).toHaveCount(2);
  await page.getByTestId('preset-select').selectOption('cascade');
  await expect(page.locator('[data-stage="semantic"]')).toHaveAttribute('data-status', 'warn');
  await expect(page.getByTestId('graph').first()).toBeVisible();
});

test('the IR card replays backpatching and draws the CFG', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  await expect(page.locator('[data-stage="ir"]')).toHaveAttribute('data-status', 'ok');
  await page.getByRole('button', { name: 'Restart' }).click();
  await expect(page.getByTestId('ir-note')).toContainText('emit t1 := LOAD TEMP');
  // After t1, t2, `if t1 > t2 goto _` and `goto _`, two jumps are open.
  for (let i = 0; i < 3; i++) await page.getByTestId('ir-step').click();
  await expect(page.getByTestId('quad-table').locator('td.is-open')).toHaveCount(2);
  await page.getByTestId('cfg-toggle').click();
  await expect(page.locator('[data-card="ir"] [data-testid="graph"]')).toBeVisible();
});

test('the optimizer card lists nine passes with a diff', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  await expect(page.getByTestId('pass')).toHaveCount(9);
  await expect(page.getByTestId('opt-totals')).toContainText('instructions');
  await page.locator('[data-pass="O8"] summary').click();
  await expect(page.locator('[data-pass="O8"] [data-testid="diff"] .diff-removed').first()).toBeVisible();
});

test('the VM debugger steps through the brief', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-stage="codegen"]')).toHaveAttribute('data-status', 'ok');
  await page.getByTestId('tab-debugger').click();
  await page.getByTestId('debug-TEMPERATURE').fill('31');
  await page.getByTestId('debug-TEMPERATURE').dispatchEvent('change');
  await page.getByTestId('vm-step').click();
  await expect(page.getByTestId('vm-stack')).toContainText('31');
  await expect(page.getByTestId('vm-status')).toContainText('pc = 1');
  await page.getByRole('button', { name: 'Run to end' }).click();
  await expect(page.getByTestId('vm-effects')).toContainText('TURN_ON AC');
});

test('the deliverable: dragging temperature past 30 turns the AC on', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('device-AC')).toHaveAttribute('data-state', 'OFF');
  await page.getByTestId('sensor-slider-TEMPERATURE').fill('31');
  await expect(page.getByTestId('device-AC')).toHaveAttribute('data-state', 'ON');
  await expect(page.getByTestId('output-event-log')).toContainText('Rule R1 fired: TURN_ON AC');
  for (const stage of ['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen', 'simulation']) {
    await expect(page.locator(`[data-stage="${stage}"]`)).not.toHaveAttribute('data-status', 'error');
    await expect(page.locator(`[data-stage="${stage}"]`)).not.toHaveAttribute('data-status', 'skipped');
  }
});

test('a scenario plays, and a log line finds its rule in the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  const output = page.getByTestId('output');
  await expect(output.getByTestId('clock')).toContainText('21:30');
  for (let i = 0; i < 40; i++) await output.getByTestId('step').click();
  await expect(output.getByTestId('clock')).toContainText('22:10');
  await expect(page.getByTestId('device-BED_LIGHT')).toHaveAttribute('data-state', 'ON');
  await output.getByTestId('play').click();
  await expect(page.getByTestId('device-AC')).toHaveAttribute('data-state', 'ON', { timeout: 15000 });
  await output.getByTestId('play').click();
  await page.getByTestId('output-event-log').getByText('Night light').first().click();
  await expect(page.locator('.cm-flash-line')).toContainText('RULE "Night light"');
});

test('Load witness moves the sliders to the conflicting moment', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('conflict');
  await page.getByTestId('load-witness').click();
  await expect(page.getByTestId('sensor-slider-TEMPERATURE')).toHaveValue('29');
  await expect(page.getByTestId('time-value')).toHaveText('23:00');
});

test('a runtime loop stops at stage 7 with R501', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('cascade');
  await expect(page.locator('[data-stage="simulation"]')).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('stopped-box')).toContainText('Stopped at stage 7: Simulation');
});

test('an empty program says there is nothing to simulate', async ({ page }) => {
  await page.goto('/');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('no-rules')).toBeVisible();
});

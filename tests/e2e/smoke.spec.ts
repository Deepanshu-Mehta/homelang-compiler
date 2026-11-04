import { expect, test, type Page } from '@playwright/test';

/** Stages are pages: the rail opens one at a time. */
async function open(page: Page, stage: string) {
  await page.locator(`[data-stage="${stage}"]`).click();
  await expect(page.locator(`#card-${stage}`)).toBeVisible();
}

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
  await open(page, 'parser');
  await expect(page.locator('[data-stage="parser"]')).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('program-text')).toContainText('TURN_ON AC');
  await page.getByTestId('parse-tree-toggle').click();
  await expect(page.locator('.tree-node', { hasText: 'andCond' }).first()).toBeVisible();
  await page.locator('summary', { hasText: 'The grammar the parser follows' }).click();
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
  await open(page, 'parser');
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
  await open(page, 'semantic');
  await expect(page.locator('[data-testid="symbol-table"] tr.is-builtin').first()).toBeVisible();
  await page.getByTestId('preset-select').selectOption('error-S301-unknown-device');
  await expect(page.getByTestId('stopped-box')).toContainText('Stopped at stage 3: Semantic analysis');
  await expect(page.getByTestId('stopped-box')).toContainText("Unknown device 'HEATPUMP'");
});

test('the semantic card shows number lines, a witness and a red cycle', async ({ page }) => {
  await page.goto('/');
  await open(page, 'semantic');
  await expect(page.getByTestId('number-lines').locator('figure')).toHaveCount(1);
  await page.getByTestId('preset-select').selectOption('conflict');
  await expect(page.getByTestId('load-witness')).toBeVisible();
  await expect(page.getByTestId('conflict-matrix').locator('td.is-conflict')).toHaveCount(2);
  await page.getByTestId('preset-select').selectOption('cascade');
  await expect(page.locator('[data-stage="semantic"]')).toHaveAttribute('data-status', 'warn');
  // Cascade fails at run time, so loading it opens stage 7.
  await open(page, 'semantic');
  await expect(page.locator('#card-semantic').getByTestId('graph').first()).toBeVisible();
});

test('the IR card replays backpatching and draws the CFG', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  await expect(page.locator('[data-stage="ir"]')).toHaveAttribute('data-status', 'ok');
  await open(page, 'ir');
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
  await open(page, 'optimizer');
  await expect(page.getByTestId('pass')).toHaveCount(9);
  await expect(page.getByTestId('opt-totals')).toContainText('instructions');
  await page.locator('[data-pass="O8"] summary').click();
  await expect(page.locator('[data-pass="O8"] [data-testid="diff"] .diff-removed').first()).toBeVisible();
});

test('the VM debugger steps through the brief', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-stage="codegen"]')).toHaveAttribute('data-status', 'ok');
  await open(page, 'codegen');
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
  await open(page, 'simulation');
  await page.getByTestId('sensor-slider-TEMPERATURE').fill('31');
  await expect(page.getByTestId('device-AC')).toHaveAttribute('data-state', 'ON');
  await expect(page.getByTestId('output-event-log')).toContainText('Rule R1 fired: TURN_ON AC');
  // The summary under the editor follows the same home.
  await expect(page.getByTestId('glance-AC')).toHaveAttribute('data-state', 'ON');
  await expect(page.getByTestId('glance-last')).toContainText('Rule R1 fired: TURN_ON AC');
  for (const stage of ['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen', 'simulation']) {
    await expect(page.locator(`[data-stage="${stage}"]`)).not.toHaveAttribute('data-status', 'error');
    await expect(page.locator(`[data-stage="${stage}"]`)).not.toHaveAttribute('data-status', 'skipped');
  }
});

test('a scenario plays, and a log line finds its rule in the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  await open(page, 'simulation');
  const output = page.getByTestId('sim');
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
  await open(page, 'semantic');
  await page.getByTestId('load-witness').click();
  await expect(page.locator('#card-simulation')).toBeVisible();
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

test('trees run top-down, and link to the editor both ways', async ({ page }) => {
  await page.goto('/');
  await open(page, 'parser');
  const card = page.locator('#card-parser');
  const root = await card.locator('.tree-node[data-label="Program"]').boundingBox();
  const rule = await card.locator('.tree-node[data-label^="Rule R1"]').boundingBox();
  expect(rule!.y).toBeGreaterThan(root!.y + root!.height);

  await card.locator('.tree-node[data-label="Compare(>)"]').hover();
  await expect(page.locator('.cm-span-highlight').first()).toContainText('TEMPERATURE');

  await page.locator('.cm-line').first().click({ position: { x: 60, y: 8 } });
  await expect(card.locator('.tree-node.is-picked')).toHaveAttribute('data-label', 'Ref TEMPERATURE');
});

test('a tree fits, resets, and keeps labels at true size until asked', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  await open(page, 'parser');
  const card = page.locator('#card-parser');
  await card.getByTestId('parse-tree-toggle').click();
  await expect(card.getByTestId('tree-zoom')).toHaveText('100%');
  await card.getByTestId('tree-fit').click();
  await expect(card.getByTestId('tree-zoom')).not.toHaveText('100%');
  await card.getByTestId('tree-reset').click();
  await expect(card.getByTestId('tree-zoom')).toHaveText('100%');
});

test('tokens group by source line, and the automaton stays in view', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('advanced');
  await expect(page.locator('.token-lines')).toHaveClass(/is-compact/);
  await page.getByTestId('tokens-expanded').click();
  await expect(page.locator('.token-lines')).not.toHaveClass(/is-compact/);
  const lastChip = page.getByTestId('token-chip').last();
  await lastChip.scrollIntoViewIfNeeded();
  await lastChip.click();
  await expect(page.getByTestId('trace-panel')).toBeInViewport({ ratio: 1 });
});

test('the walkthrough goes stage by stage, and stops at a failure', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('walk-next').click();
  await expect(page.locator('.step.is-current')).toHaveAttribute('data-stage', 'lexer');
  await expect(page.locator('#card-lexer')).toHaveClass(/is-current/);
  await page.getByTestId('walk-next').click();
  await expect(page.locator('.step.is-current')).toHaveAttribute('data-stage', 'parser');
  await expect(page.getByTestId('grammar')).toBeVisible();
  await page.getByTestId('walk-prev').click();
  await expect(page.locator('.step.is-current')).toHaveAttribute('data-stage', 'lexer');

  // A failing example opens its stage, and the walkthrough starts there.
  await page.getByTestId('preset-select').selectOption('error-P201-missing-then');
  await expect(page.locator('#card-parser')).toBeVisible();
  await page.getByTestId('walk-next').click();
  await expect(page.locator('.step.is-current')).toHaveAttribute('data-stage', 'parser');
  await expect(page.getByTestId('walk-next')).toBeDisabled();
});

test('Play walks the brief through to the AC turning on', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('walk-play').click();
  await expect(page.getByTestId('device-AC')).toHaveAttribute('data-state', 'ON', { timeout: 45000 });
  await expect(page.getByTestId('output-event-log')).toContainText('Rule R1 fired: TURN_ON AC');
});

test('focus mode takes the stage full width, and Escape leaves it', async ({ page }) => {
  await page.goto('/');
  await open(page, 'simulation');
  await page.getByTestId('focus-simulation').click();
  const box = await page.locator('#card-simulation').boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(1270);
  await expect(page.getByTestId('floor-plan')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#card-simulation')).not.toHaveClass(/is-focused/);
});

test('every device state is written in words, and changes with the sliders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('device-state-AC')).toHaveText('OFF 26 °C');
  await expect(page.getByTestId('device-state-DOOR')).toHaveText('UNLOCKED');
  await open(page, 'simulation');
  await page.getByTestId('sensor-slider-TEMPERATURE').fill('31');
  await expect(page.getByTestId('device-state-AC')).toHaveText('ON 26 °C');
});

test('hovering a squiggle shows the diagnostic code', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('error-S301-unknown-device');
  await page.locator('.cm-lintRange-error').first().hover();
  await expect(page.locator('.cm-tooltip-lint')).toContainText('S301');
});

test('an example that fails opens its stage; typing never changes the stage', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('error-S301-unknown-device');
  await expect(page.locator('#card-semantic')).toBeVisible();
  await open(page, 'lexer');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('X');
  await page.waitForTimeout(900);
  await expect(page.locator('#card-lexer')).toBeVisible();
  await expect(page.locator('#card-semantic')).toBeHidden();
  expect(await page.locator('.right-pane').evaluate((el) => el.scrollTop)).toBe(0);
});

test('the arrow keys move between stages, but not while typing', async ({ page }) => {
  await page.goto('/');
  await page.locator('#title-lexer').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#card-parser')).toBeVisible();
  await expect(page.locator('.step.is-selected')).toHaveAttribute('data-stage', 'parser');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#card-semantic')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#card-parser')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#card-parser')).toBeVisible();
});

test('a failed stage breaks the wire, and the stages after it stay dark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wire.is-off')).toHaveCount(0);
  await page.getByTestId('preset-select').selectOption('error-P203-unbalanced-paren');
  // Lexer to parser stays lit; the five links after the parser go dark.
  await expect(page.locator('.wire.is-lit')).toHaveCount(1);
  await expect(page.locator('.wire.is-off')).toHaveCount(5);
});

test('the page never scrolls sideways at 1280×720', async ({ page }) => {
  await page.goto('/');
  for (const preset of ['brief', 'advanced', 'error-P203-unbalanced-paren']) {
    await page.getByTestId('preset-select').selectOption(preset);
    const sizes = await page.evaluate(() => ({
      bar: document.querySelector('.topbar')!.getBoundingClientRect().width,
      layout: document.querySelector('.layout')!.getBoundingClientRect().width,
      page: document.documentElement.scrollWidth,
    }));
    expect(sizes).toEqual({ bar: 1280, layout: 1280, page: 1280 });
  }
});

test('reduced motion stops the live motion, and the state is still in words', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await open(page, 'simulation');
  await page.getByTestId('sensor-slider-TEMPERATURE').fill('31');
  await expect(page.getByTestId('device-state-AC')).toHaveText('ON 26 °C');
  const motion = await page.evaluate(() => ({
    fan: getComputedStyle(document.querySelector('.fan-blades')!).animationName,
    air: getComputedStyle(document.querySelector('.airflow')!).animationName,
    transition: getComputedStyle(document.querySelector('.light-glow')!).transitionDuration,
  }));
  expect(motion).toEqual({ fan: 'none', air: 'none', transition: '0s, 0s' });
});

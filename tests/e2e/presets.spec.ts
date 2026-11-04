import { expect, test } from '@playwright/test';

const STAGES = ['lexer', 'parser', 'semantic', 'ir', 'optimizer', 'codegen', 'simulation'] as const;
const CARDS = ['domain', ...STAGES] as const;

const clean = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'];
const warns = ['ok', 'ok', 'warn', 'ok', 'ok', 'ok', 'ok'];
const lexError = ['error', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped'];
const parseError = ['ok', 'error', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped'];
const semanticError = ['ok', 'ok', 'error', 'skipped', 'skipped', 'skipped', 'skipped'];

/**
 * The cards live in a scrolling pane, which would clip a tall card and paint the
 * sticky pipeline bar over it. This lays the page out flat for the screenshots.
 */
const FLAT_PAGE = `
  html, body, #app, .app { height: auto; }
  .app { display: block; }
  .layout { display: block; }
  .left-pane, .right-pane { overflow: visible; }
  .pipeline { position: static; }
`;

/** preset → status of each stage, then the stage that should stop it, if any. */
const PRESETS: readonly [string, readonly string[], string?][] = [
  ['brief', warns],
  ['living-room', warns],
  ['night-security', clean],
  ['advanced', warns],
  ['conflict', warns],
  ['hysteresis', warns],
  ['cascade', ['ok', 'ok', 'warn', 'ok', 'ok', 'ok', 'error'], 'Stopped at stage 7: Simulation'],
  ['error-L107-bad-time', lexError, 'Stopped at stage 1: Lexer'],
  ['error-L108-unterminated-string', lexError, 'Stopped at stage 1: Lexer'],
  ['error-P201-missing-then', parseError, 'Stopped at stage 2: Parser'],
  ['error-P203-unbalanced-paren', parseError, 'Stopped at stage 2: Parser'],
  ['error-P208-turn-on', parseError, 'Stopped at stage 2: Parser'],
  ['error-S301-unknown-device', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['error-S305-action-on-sensor', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['error-S308-type-mismatch', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['error-S309-bad-state', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['error-S311-out-of-range', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['error-S313-contradictory-actions', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['error-S317-infinite-loop', semanticError, 'Stopped at stage 3: Semantic analysis'],
  ['warning-W401-contradiction', warns],
];

for (const [preset, statuses, stoppedAt] of PRESETS) {
  test(`preset ${preset}`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });

    await page.goto('/');
    await page.getByTestId('preset-select').selectOption(preset);

    for (const [i, stage] of STAGES.entries()) {
      await expect(page.locator(`[data-stage="${stage}"]`)).toHaveAttribute('data-status', statuses[i]!);
    }
    if (stoppedAt) await expect(page.getByTestId('stopped-box')).toContainText(stoppedAt);
    else await expect(page.getByTestId('stopped-box')).toHaveCount(0);

    await page.addStyleTag({ content: FLAT_PAGE });
    for (const card of CARDS) {
      if (card === 'domain') await page.getByRole('button', { name: 'Open the primer' }).click();
      else await page.locator(`[data-stage="${card}"]`).click();
      await page.locator(`#card-${card}`).screenshot({ path: `test-results/cards/${preset}/${card}.png` });
    }
    expect(problems).toEqual([]);
  });
}

test('"Show the error" opens the failing stage', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset-select').selectOption('error-S308-type-mismatch');
  await page.locator('[data-stage="lexer"]').click();
  await expect(page.locator('#card-semantic')).toBeHidden();
  await page.getByTestId('stopped-box').getByRole('button', { name: 'Show the error' }).click();
  await expect(page.locator('#card-semantic')).toBeInViewport();
});

test('a station on the rail opens its stage, and only that stage', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-stage="codegen"]').click();
  await expect(page.locator('#card-codegen')).toBeInViewport();
  await expect(page.locator('[data-stage="codegen"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('.stage:visible')).toHaveCount(1);
  await page.getByTestId('pager-next').click();
  await expect(page.locator('#card-simulation')).toBeVisible();
});

test('the primer opens, and the Home Assistant tab says it is approximate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the primer' }).click();
  await expect(page.locator('#card-domain')).toContainText('Ten ways automations go wrong');
  await page.addStyleTag({ content: FLAT_PAGE });
  await page.locator('#card-domain').screenshot({ path: 'test-results/cards/domain-open.png' });
  await page.locator('[data-stage="codegen"]').click();
  await page.getByTestId('tab-yaml').click();
  await expect(page.getByTestId('yaml-note')).toContainText('Approximate');
  await expect(page.getByTestId('ha-yaml')).toContainText('climate.turn_on');
});

test('the layout fits 1280×720 with no sideways scrolling', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

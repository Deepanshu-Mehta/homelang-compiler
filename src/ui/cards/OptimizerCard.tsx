import type { OptimizerOutput, PassReport, StageResult } from '../../compiler/index';
import { Card, SkippedNote } from '../Card';
import { DiffView } from '../viz/DiffView';

function byId(a: PassReport, b: PassReport): number {
  return a.id.localeCompare(b.id);
}

function PassPanel({ pass }: { pass: PassReport }) {
  const count = pass.changes.length;
  return (
    <details class={`pass ${count ? 'is-active' : ''}`} data-testid="pass" data-pass={pass.id}>
      <summary>
        <code>{pass.id}</code> {pass.title}
        <span class="pass-count">{count ? `${count} change${count === 1 ? '' : 's'}` : 'nothing to do'}</span>
      </summary>
      <p class="pass-reason"><strong>Why it is safe:</strong> {pass.reason}</p>
      <p class="muted small">Works on the {pass.level === 'AST' ? 'AST' : 'quadruples'}. Runs {ordinal(pass.runOrder)} of nine. {pass.quadsBefore} → {pass.quadsAfter} instructions.</p>
      {count > 0 && (
        <>
          <ul class="change-list">
            {pass.changes.map((c, i) => <li key={i}><code>{c.before}</code> <span class="muted">→</span> <code>{c.after}</code></li>)}
          </ul>
          <DiffView before={pass.before} after={pass.after} />
        </>
      )}
    </details>
  );
}

function ordinal(n: number): string {
  return ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][n - 1] ?? String(n);
}

export function OptimizerCard({ stage }: { stage: StageResult }) {
  const output = stage.output as OptimizerOutput | null;
  return (
    <Card stage={stage}
      intro="Rewrites the code into fewer instructions without changing what the home does. Each pass has a reason it is safe, and a test runs the original and optimized programs side by side to check.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {output && (
        <>
          <p class="stat-line" data-testid="opt-totals">
            {output.totals.quadsBefore} → {output.totals.quadsAfter} instructions, {output.totals.jumpsBefore - output.totals.jumpsAfter} jump{output.totals.jumpsBefore - output.totals.jumpsAfter === 1 ? '' : 's'} removed.
          </p>
          <div class="passes">
            {[...output.passes].sort(byId).map((pass) => <PassPanel key={pass.id} pass={pass} />)}
          </div>
          <details class="reference">
            <summary>The final code</summary>
            <pre class="code-block">{output.passes.at(-1)?.after.join('\n') || '(no code)'}</pre>
          </details>
        </>
      )}
    </Card>
  );
}

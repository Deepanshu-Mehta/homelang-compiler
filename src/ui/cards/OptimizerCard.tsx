import { useState } from 'preact/hooks';
import type { OptimizerOutput, PassReport, StageResult } from '../../compiler/index';
import { Card, SkippedNote, useWalkStep } from '../Card';
import { DiffView } from '../viz/DiffView';

/** How long the walkthrough shows each pass. */
const PASS_MS = 1600;

function byId(a: PassReport, b: PassReport): number {
  return a.id.localeCompare(b.id);
}

function PassPanel({ pass, open }: { pass: PassReport; open: boolean }) {
  const count = pass.changes.length;
  return (
    <details class={`pass ${count ? 'is-active' : ''} ${open ? 'is-walking' : ''}`} open={open} data-testid="pass" data-pass={pass.id}>
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

/** "They run as O3, O4, O5, O9 on the AST, then O2, O1, … on the quadruples." */
function runOrderText(passes: readonly PassReport[]): string {
  const inOrder = [...passes].sort((a, b) => a.runOrder - b.runOrder);
  const ids = (level: PassReport['level']) => inOrder.filter((p) => p.level === level).map((p) => p.id).join(', ');
  return `Numbered as in the course; they run as ${ids('AST')} on the AST, then ${ids('IR')} on the quadruples.`;
}

function ordinal(n: number): string {
  return ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'][n - 1] ?? String(n);
}

export function OptimizerCard({ stage }: { stage: StageResult }) {
  const output = stage.output as OptimizerOutput | null;
  const [walkingPass, setWalkingPass] = useState<string | null>(null);

  // Opens each pass that changed something, in the order the passes really ran.
  useWalkStep('optimizer', (done) => {
    const active = output?.passes.filter((p) => p.changes.length > 0) ?? [];
    if (active.length === 0) {
      done();
      return undefined;
    }
    let at = 0;
    setWalkingPass(active[0]!.id);
    const timer = setInterval(() => {
      at++;
      if (at >= active.length) {
        clearInterval(timer);
        done();
      } else {
        setWalkingPass(active[at]!.id);
      }
    }, PASS_MS);
    return () => clearInterval(timer);
  });

  return (
    <Card stage={stage}
      intro="Rewrites the code into fewer instructions without changing what the home does. Each pass has a reason it is safe, and a test runs the original and optimized programs side by side to check.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {output && (
        <>
          <p class="stat-line" data-testid="opt-totals">
            {output.totals.quadsBefore} → {output.totals.quadsAfter} instructions, {output.totals.jumpsBefore - output.totals.jumpsAfter} jump{output.totals.jumpsBefore - output.totals.jumpsAfter === 1 ? '' : 's'} removed.
          </p>
          <p class="muted small" data-testid="opt-run-order">{runOrderText(output.passes)}</p>
          <div class="passes">
            {[...output.passes].sort(byId).map((pass) => <PassPanel key={pass.id} pass={pass} open={walkingPass === pass.id} />)}
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

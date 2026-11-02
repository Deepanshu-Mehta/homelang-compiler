import { useEffect, useMemo, useState } from 'preact/hooks';
import { quadColumns, type IrOutput, type Quad, type StageResult } from '../../compiler/index';
import { Card, SkippedNote } from '../Card';
import { GraphView, type GraphEdge, type GraphNode } from '../viz/GraphView';

const PLAY_MS = 650;

/** Which quads exist, and which jumps are filled, after a given animation step. */
function stateAt(output: IrOutput, step: number) {
  const steps = output.steps.slice(0, step + 1);
  const filled = new Set(steps.flatMap((s) => s.patched));
  return { visible: output.steps[step]?.emitted ?? output.program.quads.length, filled };
}

function withHiddenTarget(quad: Quad, filled: ReadonlySet<number>): Quad {
  const isOpen = 'target' in quad && !filled.has(quad.index);
  return isOpen ? { ...quad, target: null } : quad;
}

function QuadTable({ output, step }: { output: IrOutput; step: number }) {
  const { visible, filled } = stateAt(output, step);
  const justPatched = new Set(output.steps[step]?.patched ?? []);
  const { quads, routines } = output.program;
  const starts = new Map(routines.map((r) => [r.start, r.ruleId]));

  return (
    <div class="table-scroll quad-scroll">
      <table class="compact quads" data-testid="quad-table">
        <thead><tr><th>#</th><th>op</th><th>arg1</th><th>arg2</th><th>result</th></tr></thead>
        <tbody>
          {quads.slice(0, visible).flatMap((quad) => {
            const row = quadColumns(withHiddenTarget(quad, filled));
            const open = row.result === '_';
            const rows = [(
              <tr key={quad.index} class={justPatched.has(quad.index) ? 'is-patched' : ''}>
                <td>{quad.index}</td><td><code>{row.op}</code></td><td><code>{row.arg1}</code></td><td><code>{row.arg2}</code></td>
                <td class={open ? 'is-open' : ''}><code>{row.result}</code></td>
              </tr>
            )];
            const ruleId = starts.get(quad.index);
            if (ruleId) rows.unshift(<tr key={`rule-${ruleId}`} class="rule-row"><td colSpan={5}>{ruleId}</td></tr>);
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stepper({ output, step, setStep }: { output: IrOutput; step: number; setStep: (n: number) => void }) {
  const [playing, setPlaying] = useState(false);
  const last = output.steps.length - 1;

  useEffect(() => {
    if (!playing) return undefined;
    if (step >= last) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setStep(step + 1), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, step, last, setStep]);

  return (
    <div class="toolbar">
      <button onClick={() => setStep(0)} disabled={step === 0}>Restart</button>
      <button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
      <button data-testid="ir-step" onClick={() => setStep(Math.min(last, step + 1))} disabled={step >= last}>Step</button>
      <span class="toolbar-note" data-testid="ir-note">
        {step + 1} of {output.steps.length}: <code>{output.steps[step]?.note}</code>
      </span>
    </div>
  );
}

function CfgView({ output }: { output: IrOutput }) {
  const ruleIds = output.program.routines.map((r) => r.ruleId);
  const [ruleId, setRuleId] = useState(ruleIds[0]);
  const shown = ruleIds.includes(ruleId ?? '') ? ruleId : ruleIds[0];

  const { nodes, edges } = useMemo(() => {
    const blocks = output.cfg.blocks.filter((b) => b.ruleId === shown);
    const ids = new Set(blocks.map((b) => b.id));
    const graphNodes: GraphNode[] = blocks.map((b) => ({ id: b.id, label: `${b.id}\n${b.lines.join('\n')}` }));
    const graphEdges: GraphEdge[] = output.cfg.edges.filter((e) => ids.has(e.from)).map((e) => ({
      from: e.from, to: e.to,
      ...(e.kind === 'true' && { tone: 'green' as const, label: 'true' }),
      ...(e.kind === 'false' && { tone: 'red' as const, label: 'false' }),
    }));
    return { nodes: graphNodes, edges: graphEdges };
  }, [output, shown]);

  return (
    <>
      <label class="small">Rule{' '}
        <select value={shown} onChange={(e) => setRuleId(e.currentTarget.value)}>
          {ruleIds.map((id) => <option key={id}>{id}</option>)}
        </select>
      </label>
      <GraphView nodes={nodes} edges={edges} />
      <p class="muted small">Each box is a basic block: code that runs straight through, with one way in and one way out. Green edges are taken when the test is true, red when it is false.</p>
    </>
  );
}

export function IrCard({ stage }: { stage: StageResult }) {
  const output = stage.output as IrOutput | null;
  const [view, setView] = useState<'table' | 'cfg'>('table');
  const [step, setStep] = useState(Number.MAX_SAFE_INTEGER);

  useEffect(() => setStep(Number.MAX_SAFE_INTEGER), [output]);
  const last = (output?.steps.length ?? 1) - 1;
  const current = Math.min(step, last);

  return (
    <Card stage={stage}
      intro="Each rule becomes simple instructions with at most three operands. AND, OR and NOT produce no instructions at all: they turn into jumps, so a test that cannot change the answer is skipped.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {output && output.program.quads.length === 0 && <p class="muted">There are no rules to translate.</p>}
      {output && output.program.quads.length > 0 && (
        <>
          <div class="segmented" role="group" aria-label="Code view">
            <button class={view === 'table' ? 'is-on' : ''} onClick={() => setView('table')}>Quadruples</button>
            <button class={view === 'cfg' ? 'is-on' : ''} data-testid="cfg-toggle" onClick={() => setView('cfg')}>Control-flow graph</button>
          </div>
          {view === 'table' ? (
            <>
              <p class="muted small">Backpatching: a jump is written before its destination is known, so its target stays blank (orange) on a list. Once the label is reached, the whole list is filled in at once. Press Restart, then Step, to watch it.</p>
              <Stepper output={output} step={current} setStep={setStep} />
              <QuadTable output={output} step={current} />
            </>
          ) : <CfgView output={output} />}
        </>
      )}
    </Card>
  );
}

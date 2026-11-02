import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { emit, VmDebugger, type CodegenOutput, type Instr, type ObjectFile, type StageResult, type Value } from '../../compiler/index';
import { Card, SkippedNote } from '../Card';

const NO_VALUES: Record<string, Value> = {};

function Listing({ code, pc, entries }: { code: readonly Instr[]; pc?: number | undefined; entries: ReadonlyMap<number, string> }) {
  const current = useRef<HTMLDivElement>(null);
  useEffect(() => current.current?.scrollIntoView({ block: 'nearest' }), [pc]);
  return (
    <div class="bytecode" data-testid="bytecode">
      {code.map((instr, i) => (
        <div key={i} ref={i === pc ? current : undefined}
          class={`bytecode-line ${i === pc ? 'is-current' : ''} ${entries.has(i) ? 'is-entry' : ''}`}>
          <span class="bytecode-pc">{i}</span>
          <span class="bytecode-op">{instr[0]}</span>
          <span>{instr.slice(1).join(' ')}</span>
          {entries.has(i) && <span class="bytecode-rule">{entries.get(i)}</span>}
        </div>
      ))}
    </div>
  );
}

function VmDebuggerPanel({ object }: { object: ObjectFile }) {
  const [ruleId, setRuleId] = useState(object.rules[0]?.id ?? '');
  const rule = object.rules.find((r) => r.id === ruleId) ?? object.rules[0];
  // Values belong to one compile result, so a new program starts from defaults.
  const [saved, setSaved] = useState<{ object: ObjectFile; values: Record<string, Value> }>({ object, values: NO_VALUES });
  const values = saved.object === object ? saved.values : NO_VALUES;
  const setValues = (next: Record<string, Value>) => setSaved({ object, values: next });
  const [wasTrue, setWasTrue] = useState(false);
  const [, redraw] = useState(0);

  const vm = useMemo(
    () => (rule ? new VmDebugger(object, rule.id, values, wasTrue) : null),
    [object, rule, values, wasTrue],
  );

  if (!vm || !rule) return <p class="muted">There are no rules to run.</p>;
  const entries = new Map(object.rules.map((r) => [r.entry, r.id]));

  const stepOnce = () => { vm.step(); redraw((n) => n + 1); };
  const runAll = () => { while (!vm.done) vm.step(); redraw((n) => n + 1); };
  const reset = () => { setValues({ ...values }); redraw((n) => n + 1); };

  const inputFor = (name: string) => {
    const sensor = object.sensors.find((s) => s.name === name);
    const device = object.devices.find((d) => d.name === name);
    const initial = sensor?.initial ?? device?.initialState ?? (name === 'TIME' ? 720 : 'MON');
    const states = sensor?.states ?? device?.states;
    const value = values[name] ?? initial;
    return (
      <label key={name} class="debug-input">
        <code>{name}</code>
        {states ? (
          <select value={String(value)} onChange={(e) => setValues({ ...values, [name]: e.currentTarget.value })}>
            {states.map((s) => <option key={s}>{s}</option>)}
          </select>
        ) : (
          <input type="number" value={Number(value)} data-testid={`debug-${name}`}
            onChange={(e) => setValues({ ...values, [name]: Number(e.currentTarget.value) })} />
        )}
      </label>
    );
  };

  return (
    <div class="debugger" data-testid="debugger">
      <div class="debug-controls">
        <label class="debug-input">Rule
          <select value={rule.id} onChange={(e) => setRuleId(e.currentTarget.value)}>
            {object.rules.map((r) => <option key={r.id}>{r.id}</option>)}
          </select>
        </label>
        {rule.reads.map(inputFor)}
        {rule.kind === 'STATE' && (
          <label class="debug-input"><input type="checkbox" checked={wasTrue} onChange={(e) => setWasTrue(e.currentTarget.checked)} /> was already true</label>
        )}
      </div>
      <div class="stepper">
        <button data-testid="vm-step" onClick={stepOnce} disabled={vm.done}>Step</button>
        <button onClick={runAll} disabled={vm.done}>Run to end</button>
        <button onClick={reset}>Reset</button>
        <span class="stepper-note" data-testid="vm-status">pc = {vm.frame.pc}, {vm.frame.status}</span>
      </div>
      <div class="debug-grid">
        <Listing code={object.code} pc={vm.frame.pc} entries={entries} />
        <div>
          <h4>Stack</h4>
          <div class="stack" data-testid="vm-stack">
            {vm.frame.stack.length === 0 && <span class="muted small">empty</span>}
            {[...vm.frame.stack].reverse().map((value, i) => <div key={i} class="stack-cell">{String(value)}</div>)}
          </div>
          <h4>What happened</h4>
          <ul class="effects" data-testid="vm-effects">
            {vm.effects.map((e, i) => <li key={i}><code>{e.pc}</code> {e.text}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

type Tab = 'bytecode' | 'debugger' | 'json' | 'yaml';

export function CodegenCard({ stage }: { stage: StageResult }) {
  const object = stage.output as CodegenOutput | null;
  const [tab, setTab] = useState<Tab>('bytecode');
  const tabs: readonly { id: Tab; label: string }[] = [
    { id: 'bytecode', label: 'Bytecode' },
    { id: 'debugger', label: 'VM debugger' },
    { id: 'json', label: 'Object file (JSON)' },
    { id: 'yaml', label: 'Home Assistant YAML' },
  ];
  return (
    <Card id="codegen" badge="6" title="Code generation" status={stage.status}
      intro="Turns the quadruples into bytecode for a small stack machine: values are pushed, operators pop them and push the result, and jumps move the program counter.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {object && (
        <>
          <p class="stat-line" data-testid="codegen-stats">{object.code.length} instructions for {object.rules.length} rule{object.rules.length === 1 ? '' : 's'}.</p>
          <div class="view-toggle" role="group" aria-label="Output format">
            {tabs.map(({ id, label }) => (
              <button key={id} class={tab === id ? 'is-on' : ''} data-testid={`tab-${id}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'bytecode' && <Listing code={object.code} entries={new Map(object.rules.map((r) => [r.entry, r.id]))} />}
          {tab === 'debugger' && <VmDebuggerPanel object={object} />}
          {tab === 'json' && <pre class="code-block tall">{emit('bytecode', stage)}</pre>}
          {tab === 'yaml' && (
            <>
              <p class="approximate" data-testid="yaml-note"><strong>Approximate.</strong> This shows how the rules could look in a real platform, but the meaning differs. Home Assistant triggers fire on their own entity only, so each value a rule reads becomes a trigger, and ELSE becomes a second automation.</p>
              <pre class="code-block tall" data-testid="ha-yaml">{object.haYaml}</pre>
            </>
          )}
        </>
      )}
    </Card>
  );
}


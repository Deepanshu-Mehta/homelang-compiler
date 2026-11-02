import { useMemo, useState } from 'preact/hooks';
import {
  failedStage, formatMinutes, type CompileResult, type LogEntry, type ObjectFile,
} from '../compiler/index';
import { Controls } from './Controls';
import { EventLog } from './EventLog';
import { CrossIcon, PauseIcon, PlayIcon } from './icons';
import { scrollToCard } from './scroll';
import type { Simulation, Speed } from './useSimulation';
import { FloorPlan } from './viz/FloorPlan';

const SPEEDS: readonly Speed[] = [1, 10, 60];

export function PlayControls({ sim }: { sim: Simulation }) {
  const { session, state, playing, speed } = sim;
  if (!session.hasScenario) return null;
  return (
    <div class="play-controls" data-testid="play-controls">
      <button class="button" onClick={sim.togglePlay} disabled={session.finished} data-testid="play">
        {playing ? <PauseIcon /> : <PlayIcon />} {playing ? 'Pause' : 'Play'}
      </button>
      <button class="button" onClick={sim.step} disabled={session.finished} data-testid="step">Step</button>
      <button class="button" onClick={sim.reset} data-testid="reset">Reset</button>
      <div class="segmented" role="group" aria-label="Speed">
        {SPEEDS.map((s) => <button key={s} class={speed === s ? 'is-on' : ''} onClick={() => sim.setSpeed(s)}>{s}×</button>)}
      </div>
      <span class="clock" data-testid="clock">{state.day} {formatMinutes(state.minutes)}</span>
    </div>
  );
}

export function devicesIn(entry: LogEntry | null, sim: Simulation): ReadonlySet<string> {
  if (!entry) return new Set();
  return new Set(sim.state.devices.map((d) => d.name).filter((name) => new RegExp(`\\b${name}\\b`).test(entry.text)));
}

interface OutputPaneProps {
  result: CompileResult;
  sim: Simulation | null;
  object: ObjectFile | null;
  onLine: (line: number) => void;
}

export function OutputPane({ result, sim, object, onLine }: OutputPaneProps) {
  const failed = failedStage(result);
  const [hovered, setHovered] = useState<LogEntry | null>(null);
  const flashing = useMemo(() => (sim ? devicesIn(hovered, sim) : new Set<string>()), [hovered, sim]);
  const ruleCount = object?.rules.length ?? 0;
  const empty = object !== null && ruleCount === 0 && !object.scenario;
  // Broken code keeps the last working home on screen, marked as out of date.
  const stale = failed !== undefined && failed.stage !== 'simulation';

  return (
    <section class="output" data-testid="output">
      <header class="pane-head">
        <h2>Output</h2>
        <span class="pane-note">{failed ? 'Stopped' : `${ruleCount} rule${ruleCount === 1 ? '' : 's'}`}</span>
      </header>
      {failed && (
        <div class="stopped-box" data-testid="stopped-box">
          <p class="stopped-title"><CrossIcon /> Stopped at stage {failed.number}: {failed.title}</p>
          <p>{failed.diagnostics.find((d) => d.severity === 'error')?.message}</p>
          <button class="link-button" onClick={() => scrollToCard(failed.stage)}>Show the error</button>
        </div>
      )}
      {empty && <p class="muted" data-testid="no-rules">No rules: nothing to simulate.</p>}
      {sim && object && !empty && (
        <div class={`output-live ${stale ? 'is-stale' : ''}`}>
          <PlayControls sim={sim} />
          <FloorPlan state={sim.state} rooms={object.rooms} flashing={flashing} id="output" />
          <Controls sim={sim} object={object} id="output" />
          <div class="log-block">
            <h3>Event log</h3>
            <EventLog entries={sim.session.log} onLine={onLine} onHover={setHovered} id="output" />
          </div>
          {sim.state.notifications.length > 0 && (
            <ul class="notifications" data-testid="notifications" aria-label="Notifications">
              {sim.state.notifications.map((n, i) => <li key={i}><span class="log-time">{n.time}</span> {n.text}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

import {
  failedStage, formatMinutes, type CompileResult, type DeviceState, type LogEntry, type ObjectFile,
} from '../compiler/index';
import type { View } from './App';
import { CheckIcon, CrossIcon, NextIcon, PauseIcon, PlayIcon, WarnIcon } from './icons';
import type { Simulation, Speed } from './useSimulation';
import { stateWords } from './viz/FloorPlan';

const SPEEDS: readonly Speed[] = [1, 10, 60];

export function PlayControls({ sim }: { sim: Simulation }) {
  const { session, state, playing, speed } = sim;
  if (!session.hasScenario) return null;
  return (
    <div class="play-controls" data-testid="play-controls">
      <button class="button is-primary" onClick={sim.togglePlay} disabled={session.finished} data-testid="play">
        {playing ? <PauseIcon /> : <PlayIcon />} {playing ? 'Pause' : 'Play scenario'}
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

/** Whether a device is doing something: on, open or unlocked. */
function isActive(device: DeviceState): boolean {
  return device.state === 'ON' || device.state === 'OPEN' || device.state === 'UNLOCKED';
}

interface ResultPanelProps {
  result: CompileResult;
  sim: Simulation | null;
  object: ObjectFile | null;
  onShow: (view: View) => void;
}

/**
 * What the program produced, under the editor: where it stopped, or a
 * one-line-per-device view of the home that stays live on every stage.
 */
export function ResultPanel({ result, sim, object, onShow }: ResultPanelProps) {
  const failed = failedStage(result);
  const ruleCount = object?.rules.length ?? 0;
  const warnings = result.stages.reduce((n, s) => n + s.diagnostics.filter((d) => d.severity === 'warning').length, 0);
  const empty = object !== null && ruleCount === 0 && !object.scenario;
  // Broken code keeps the last working home on screen, marked as out of date.
  const stale = failed !== undefined && failed.stage !== 'simulation';
  const lastFired = sim ? [...sim.session.log].reverse().find((e) => e.kind === 'fired') : undefined;

  return (
    <section class="result" data-testid="result" aria-label="Result">
      {failed ? (
        <div class="stopped-box" data-testid="stopped-box">
          <p class="stopped-title"><CrossIcon /> Stopped at stage {failed.number}: {failed.title}</p>
          <p>{failed.diagnostics.find((d) => d.severity === 'error')?.message}</p>
          <button class="link-button" onClick={() => onShow(failed.stage)}>Show the error</button>
        </div>
      ) : (
        <p class="compiled-line" data-testid="compiled-line">
          <CheckIcon /> Compiled: {ruleCount} rule{ruleCount === 1 ? '' : 's'}
          {warnings > 0 && <span class="compiled-warnings"><WarnIcon /> {warnings} warning{warnings === 1 ? '' : 's'}</span>}
        </p>
      )}
      {empty && <p class="muted" data-testid="no-rules">No rules: nothing to simulate.</p>}
      {sim && object && !empty && (
        <div class={`glance ${stale ? 'is-stale' : ''}`} data-testid="glance">
          <header class="glance-head">
            <h2>Home now{stale && <span class="glance-note"> · last working program</span>}</h2>
            <button class="link-button" data-testid="open-home" onClick={() => onShow('simulation')}>
              Open the home <NextIcon />
            </button>
          </header>
          <ul class="glance-list">
            {sim.state.devices.map((device) => (
              <li key={device.name} class={`glance-device ${isActive(device) ? 'is-active' : ''}`}
                data-testid={`glance-${device.name}`} data-state={device.state}>
                <span class="glance-dot" aria-hidden="true" />
                <span class="glance-name">{device.name}</span>
                <span class="glance-state">{stateWords(device)}</span>
              </li>
            ))}
          </ul>
          <p class="glance-last" data-testid="glance-last">
            <span class="log-time">{formatMinutes(sim.state.minutes)}</span>{' '}
            {lastFired ? lastFired.text : 'No rule has fired yet.'}
          </p>
        </div>
      )}
    </section>
  );
}

import { useMemo, useState } from 'preact/hooks';
import {
  failedStage, formatMinutes, type CompileResult, type LogEntry, type ObjectFile, type SensorState,
} from '../compiler/index';
import { EventLog } from './EventLog';
import { scrollToCard } from './scroll';
import type { Simulation, Speed } from './useSimulation';
import { FloorPlan } from './viz/FloorPlan';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const SPEEDS: readonly Speed[] = [1, 10, 60];

/** Sliders stop at sensible values rather than the sensor's full range. */
function sliderRange(sensor: SensorState): { min: number; max: number; step: number } {
  if (sensor.unit === '°C') return { min: -10, max: 50, step: 0.5 };
  if (sensor.unit === 'lux') return { min: 0, max: 2000, step: 10 };
  return { min: 0, max: 100, step: 1 };
}

function SensorControl({ sensor, sim }: { sensor: SensorState; sim: Simulation }) {
  const { name, value, states, unit } = sensor;
  if (states) {
    return (
      <div class="control">
        <span class="control-name">{name}</span>
        <div class="toggle-group">
          {states.map((state) => (
            <button key={state} class={value === state ? 'is-on' : ''} data-testid={`sensor-toggle-${name}-${state}`}
              onClick={() => sim.setSensor(name, state)}>{state}</button>
          ))}
        </div>
      </div>
    );
  }
  const { min, max, step } = sliderRange(sensor);
  return (
    <label class="control">
      <span class="control-name">{name}</span>
      <input type="range" min={min} max={max} step={step} value={value} data-testid={`sensor-slider-${name}`}
        onInput={(e) => sim.setSensor(name, Number(e.currentTarget.value))} />
      <span class="control-value">{value}{unit ? ` ${unit}` : ''}</span>
    </label>
  );
}

export function PlayControls({ sim }: { sim: Simulation }) {
  const { session, state, playing, speed } = sim;
  if (!session.hasScenario) return null;
  return (
    <div class="play-controls" data-testid="play-controls">
      <button onClick={sim.togglePlay} disabled={session.finished} data-testid="play">{playing ? 'Pause' : 'Play'}</button>
      <button onClick={sim.step} disabled={session.finished} data-testid="step">Step</button>
      <button onClick={sim.reset} data-testid="reset">Reset</button>
      <div class="toggle-group">
        {SPEEDS.map((s) => <button key={s} class={speed === s ? 'is-on' : ''} onClick={() => sim.setSpeed(s)}>{s}×</button>)}
      </div>
      <span class="clock" data-testid="clock">{state.day} {formatMinutes(state.minutes)}</span>
    </div>
  );
}

function deviceNamesIn(entry: LogEntry | null, sim: Simulation): ReadonlySet<string> {
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
  const flashing = useMemo(() => (sim ? deviceNamesIn(hovered, sim) : new Set<string>()), [hovered, sim]);
  const ruleCount = object?.rules.length ?? 0;
  const empty = object !== null && ruleCount === 0 && !object.scenario;

  return (
    <section class="output" data-testid="output">
      <header class="pane-head">
        <h2>Output</h2>
        <span class="pane-note">{failed ? 'STOPPED' : `${ruleCount} RULE${ruleCount === 1 ? '' : 'S'}`}</span>
      </header>
      {failed && (
        <div class="stopped-box" data-testid="stopped-box">
          <p class="stopped-title">Stopped at stage {failed.number}: {failed.title}</p>
          <p>{failed.diagnostics.find((d) => d.severity === 'error')?.message}</p>
          <button class="link-button" onClick={() => scrollToCard(failed.stage)}>Show the error</button>
        </div>
      )}
      {empty && <p class="muted" data-testid="no-rules">No rules: nothing to simulate.</p>}
      {sim && object && !empty && (
        <>
          <PlayControls sim={sim} />
          <FloorPlan state={sim.state} rooms={object.rooms} flashing={flashing} id="output" />
          <div class="controls" data-testid="controls">
            {sim.state.sensors.map((sensor) => <SensorControl key={sensor.name} sensor={sensor} sim={sim} />)}
            <label class="control">
              <span class="control-name">TIME</span>
              <input type="range" min={0} max={1439} step={1} value={sim.state.minutes} data-testid="time-slider"
                onInput={(e) => sim.setTime(Number(e.currentTarget.value))} />
              <span class="control-value" data-testid="time-value">{formatMinutes(sim.state.minutes)}</span>
            </label>
            <label class="control">
              <span class="control-name">DAY</span>
              <select value={sim.state.day} onChange={(e) => sim.setDay(e.currentTarget.value)}>
                {DAYS.map((day) => <option key={day}>{day}</option>)}
              </select>
            </label>
          </div>
          <h3>Event log</h3>
          <EventLog entries={sim.session.log} onLine={onLine} onHover={setHovered} id="output" />
          {sim.state.notifications.length > 0 && (
            <>
              <h3>Notifications</h3>
              <ul class="notifications" data-testid="notifications">
                {sim.state.notifications.map((n, i) => <li key={i}><span class="log-time">{n.time}</span> {n.text}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

import { useMemo, useRef, useState } from 'preact/hooks';
import { formatMinutes, type LogEntry, type ObjectFile, type StageResult } from '../../compiler/index';
import { Card, SkippedNote, useWalkStep } from '../Card';
import { DiagnosticRow } from '../DiagnosticBox';
import { EventLog } from '../EventLog';
import { Controls } from '../Controls';
import { devicesIn, PlayControls } from '../OutputPane';
import type { Simulation } from '../useSimulation';
import { FloorPlan } from '../viz/FloorPlan';

/** Steps per second when the walkthrough plays a scenario. */
const WALK_RATE = 60;
const SWEEP_MS = 320;
const SWEEP_STEPS = 12;

function Timeline({ sim }: { sim: Simulation }) {
  const { session, state } = sim;
  if (!session.hasScenario) return null;
  const length = session.lengthSeconds || 1;
  const percent = (seconds: number): string => `${Math.min(100, (seconds / length) * 100)}%`;
  return (
    <div class="timeline" data-testid="timeline">
      <div class="timeline-bar">
        <div class="timeline-done" style={{ width: percent(state.elapsedSeconds) }} />
        {session.timeline.map((event, i) => (
          <span key={i} class="timeline-mark" style={{ left: percent(event.seconds) }} title={`${formatMinutes(event.minutes)}: ${event.text}`} />
        ))}
      </div>
      <ul class="timeline-list">
        {session.timeline.map((event, i) => (
          <li key={i} class={event.seconds <= state.elapsedSeconds ? 'is-past' : ''}>
            <span class="log-time">{formatMinutes(event.minutes)}</span> {event.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SimulationCardProps {
  stage: StageResult;
  sim: Simulation | null;
  object: ObjectFile | null;
  onLine: (line: number) => void;
}

export function SimulationCard({ stage, sim, object, onLine }: SimulationCardProps) {
  const [hovered, setHovered] = useState<LogEntry | null>(null);
  const flashing = useMemo(() => (sim ? devicesIn(hovered, sim) : new Set<string>()), [hovered, sim]);
  const simRef = useRef(sim);
  simRef.current = sim;

  // Plays the scenario. A live program has none, so the first numeric sensor
  // rises until a rule fires, which is the payoff the class is waiting for.
  useWalkStep('simulation', (done) => {
    const first = simRef.current;
    if (!first) {
      done();
      return undefined;
    }
    if (first.session.hasScenario) {
      first.reset();
      const timer = setInterval(() => {
        const live = simRef.current;
        if (!live || live.session.finished) {
          clearInterval(timer);
          done();
        } else {
          live.step();
        }
      }, 1000 / WALK_RATE);
      return () => clearInterval(timer);
    }

    const sensor = first.state.sensors.find((s) => typeof s.value === 'number');
    if (!sensor) {
      done();
      return undefined;
    }
    const firedBefore = first.session.log.filter((e) => e.kind === 'fired').length;
    let value = sensor.value as number;
    let count = 0;
    const timer = setInterval(() => {
      const live = simRef.current;
      value++;
      count++;
      live?.setSensor(sensor.name, value);
      const fired = live?.session.log.filter((e) => e.kind === 'fired').length ?? 0;
      if (fired > firedBefore || count >= SWEEP_STEPS) {
        clearInterval(timer);
        done();
      }
    }, SWEEP_MS);
    return () => clearInterval(timer);
  });
  return (
    <Card stage={stage}
      intro="The bytecode runs against a simulated home. Each change is one tick: the affected rules run, their commands are resolved, and every device change can trigger more rules.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {stage.diagnostics.length > 0 && (
        <ul class="diagnostics">{stage.diagnostics.map((d, i) => <DiagnosticRow key={i} diagnostic={d} />)}</ul>
      )}
      {sim && object && (
        <>
          <p class="prose">
            {sim.session.hasScenario
              ? 'This program has a SIMULATE block. Press Play to run its timeline, or move a slider at any time.'
              : 'This program has no SIMULATE block, so the home is live: move a slider and watch what happens.'}
          </p>
          <PlayControls sim={sim} />
          <div class="sim-layout">
            <div class="sim-main">
              <FloorPlan state={sim.state} rooms={object.rooms} flashing={flashing} id="large" />
              <Timeline sim={sim} />
            </div>
            <div class="sim-side">
              <Controls sim={sim} object={object} id="large" />
              <div class="log-block">
                <h3>Event log</h3>
                <p class="muted small">Click a line to find its rule in the editor.</p>
                <EventLog entries={sim.session.log} onLine={onLine} onHover={setHovered} id="large" />
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

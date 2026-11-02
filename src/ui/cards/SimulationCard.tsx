import { useState } from 'preact/hooks';
import { formatMinutes, type LogEntry, type ObjectFile, type StageResult } from '../../compiler/index';
import { Card, SkippedNote } from '../Card';
import { DiagnosticRow } from '../DiagnosticBox';
import { EventLog } from '../EventLog';
import { PlayControls } from '../OutputPane';
import type { Simulation } from '../useSimulation';
import { FloorPlan } from '../viz/FloorPlan';

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
  const [, setHovered] = useState<LogEntry | null>(null);
  return (
    <Card id="simulation" badge="7" title="Simulation" status={stage.status}
      intro="The bytecode runs against a simulated home. Each change is one tick: the affected rules run, their commands are resolved, and every device change can trigger more rules.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {stage.diagnostics.length > 0 && (
        <ul class="diagnostics">{stage.diagnostics.map((d, i) => <DiagnosticRow key={i} diagnostic={d} />)}</ul>
      )}
      {sim && object && (
        <>
          <p class="stat-line">
            {sim.session.hasScenario
              ? 'This program has a SIMULATE block. Press Play to run its timeline, or move a slider on the left at any time.'
              : 'This program has no SIMULATE block, so the home is live: move a slider on the left and watch what happens.'}
          </p>
          <PlayControls sim={sim} />
          <FloorPlan state={sim.state} rooms={object.rooms} id="large" />
          <Timeline sim={sim} />
          <h3>Event log</h3>
          <p class="muted small">Click a line to find its rule in the editor.</p>
          <EventLog entries={sim.session.log} onLine={onLine} onHover={setHovered} id="large" />
        </>
      )}
    </Card>
  );
}

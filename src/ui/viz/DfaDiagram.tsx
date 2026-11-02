import type { Dfa, DfaEdge, DfaState } from '../../compiler/index';

const RADIUS = 17;

interface DfaDiagramProps {
  dfa: Dfa;
  /** States visited so far during a trace. */
  visited?: ReadonlySet<string>;
  /** The state the trace is on now. */
  active?: string | undefined;
}

interface DrawnEdge {
  from: DfaState;
  to: DfaState;
  label: string;
}

/** Edges between the same two states share one arrow with a joined label. */
function joinEdges(dfa: Dfa): { drawn: DrawnEdge[]; errors: DfaEdge[] } {
  const stateById = new Map(dfa.states.map((s) => [s.id, s]));
  const drawn = new Map<string, DrawnEdge>();
  const errors: DfaEdge[] = [];
  for (const edge of dfa.edges) {
    if (edge.error) { errors.push(edge); continue; }
    if (!edge.to) continue;
    const key = `${edge.from}>${edge.to}`;
    const existing = drawn.get(key);
    if (existing) existing.label += `, ${edge.label}`;
    else drawn.set(key, { from: stateById.get(edge.from)!, to: stateById.get(edge.to)!, label: edge.label });
  }
  return { drawn: [...drawn.values()], errors };
}

function SelfLoop({ state, label }: { state: DfaState; label: string }) {
  const { x, y } = state;
  const top = y - RADIUS;
  return (
    <g class="dfa-edge">
      <path d={`M ${x - 9} ${top + 2} C ${x - 26} ${top - 26}, ${x + 26} ${top - 26}, ${x + 9} ${top + 2}`}
        marker-end="url(#arrowhead)" />
      <text x={x} y={top - 24} text-anchor="middle">{label}</text>
    </g>
  );
}

function Arrow({ edge, curved }: { edge: DrawnEdge; curved: boolean }) {
  const { from, to, label } = edge;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const x1 = from.x + ux * RADIUS;
  const y1 = from.y + uy * RADIUS;
  const x2 = to.x - ux * (RADIUS + 4);
  const y2 = to.y - uy * (RADIUS + 4);
  const bend = curved ? 26 : 0;
  const cx = (x1 + x2) / 2 - uy * bend;
  const cy = (y1 + y2) / 2 + ux * bend;
  return (
    <g class="dfa-edge">
      <path d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`} marker-end="url(#arrowhead)" />
      <text x={cx} y={cy - 5} text-anchor="middle">{label}</text>
    </g>
  );
}

export function DfaDiagram({ dfa, visited, active }: DfaDiagramProps) {
  const { drawn, errors } = joinEdges(dfa);
  const hasReverse = (e: DrawnEdge) =>
    drawn.some((other) => other.from === e.to && other.to === e.from);
  const start = dfa.states.find((s) => s.id === dfa.start)!;
  const stateById = new Map(dfa.states.map((s) => [s.id, s]));

  return (
    <svg class="dfa" viewBox={`0 0 ${dfa.width} ${dfa.height}`} style={{ maxWidth: `${dfa.width}px` }} role="img"
      aria-label={`State diagram: ${dfa.title}`} data-dfa={dfa.name}>
      <defs>
        <marker id="arrowhead" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" class="arrowheadhead" />
        </marker>
      </defs>
      <path class="dfa-start" d={`M ${start.x - RADIUS - 24} ${start.y} L ${start.x - RADIUS - 4} ${start.y}`}
        marker-end="url(#arrowhead)" />
      {drawn.map((edge) =>
        edge.from === edge.to
          ? <SelfLoop key={edge.from.id} state={edge.from} label={edge.label} />
          : <Arrow key={`${edge.from.id}-${edge.to.id}`} edge={edge} curved={hasReverse(edge)} />)}
      {errors.map((edge, i) => {
        const state = stateById.get(edge.from)!;
        return (
          <text key={i} class="dfa-error" x={state.x + RADIUS + 3} y={state.y + RADIUS + 12 + 12 * (i % 2)}>
            {edge.label}
          </text>
        );
      })}
      {dfa.states.map((state) => {
        const classes = ['dfa-state'];
        if (state.accept) classes.push('is-accept');
        if (visited?.has(state.id)) classes.push('is-visited');
        if (active === state.id) classes.push('is-active');
        return (
          <g class={classes.join(' ')} key={state.id} data-state={state.id}>
            <circle cx={state.x} cy={state.y} r={RADIUS} />
            {state.accept && <circle class="dfa-ring" cx={state.x} cy={state.y} r={RADIUS - 4} />}
            <text class="dfa-id" x={state.x} y={state.y + 4} text-anchor="middle">{state.id}</text>
            {state.label && (
              <text class="dfa-label" x={state.x} y={state.y + RADIUS + 13} text-anchor="middle">{state.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

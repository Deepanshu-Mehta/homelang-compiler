import { makeDiagnostic, type Diagnostic } from '../diagnostics';
import type { Program, Rule } from '../parser/ast';
import type { EventName } from './catalog';
import { ruleWrites, triggerReads, type Write } from './effects';
import type { SymbolTable } from './symbols';

export interface DepEdge {
  from: string;
  to: string;
  /** What the write touches, e.g. "AC". */
  via: string;
  /** Some condition sits on this edge, so the cycle may stop by itself. */
  guarded: boolean;
  /** A physical effect, not a device write. Never part of a loop error. */
  physical: boolean;
}

export interface DepGraph {
  nodes: { id: string; label: string }[];
  edges: DepEdge[];
  /** Strongly connected components that contain a cycle. */
  cycles: string[][];
}

/** Which written state each device event reacts to. TOGGLE can cause either. */
const EVENT_RESULT: Partial<Record<EventName, string>> = {
  TURNS_ON: 'ON', TURNS_OFF: 'OFF', LOCKS: 'LOCKED', UNLOCKS: 'UNLOCKED', OPENS: 'OPEN', CLOSES: 'CLOSED',
};

/**
 * Physical effects: AC ON lowers temperature, and so on. These appear in the
 * graph as dashed edges and feed W411 only. If they counted as loops, the brief
 * itself (AC ON → TEMPERATURE falls → R1 reads TEMPERATURE) would be an error.
 */
const PHYSICAL_EFFECTS: readonly { deviceType: string; state: string; sensorType: string }[] = [
  { deviceType: 'AIR_CONDITIONER', state: 'ON', sensorType: 'TEMP_SENSOR' },
  { deviceType: 'HEATER', state: 'ON', sensorType: 'TEMP_SENSOR' },
  { deviceType: 'CURTAIN', state: 'OPEN', sensorType: 'LIGHT_SENSOR' },
];

function canTrigger(write: Write, target: Rule): boolean {
  if (!write.affectsPower) return false;
  const { trigger } = target;
  if (trigger.kind === 'Time') return false;
  if (trigger.kind === 'State') return triggerReads(target).has(write.device);
  if (trigger.source.name !== write.device) return false;
  const wanted = EVENT_RESULT[trigger.event];
  return write.value === wanted || write.value === 'TOGGLE' || write.value === '?';
}

/** An unguarded target fires every time, with nothing to stop the chain. */
function isGuarded(write: Write, target: Rule): boolean {
  const { trigger } = target;
  const hasCondition = trigger.kind === 'State' || (trigger.kind === 'Event' && trigger.guard !== undefined);
  return hasCondition || write.conditional || write.afterWait || write.value === 'TOGGLE';
}

export function buildDepGraph(program: Program, table: SymbolTable): DepGraph {
  const { rules } = program;
  const edges = new Map<string, DepEdge>();

  for (const source of rules) {
    for (const write of ruleWrites(source, table)) {
      for (const target of rules) {
        if (!canTrigger(write, target)) continue;
        const key = `${source.id}>${target.id}>${write.device}`;
        const guarded = isGuarded(write, target);
        const existing = edges.get(key);
        // One unguarded path is enough to make the edge unguarded.
        if (!existing || (existing.guarded && !guarded)) {
          edges.set(key, { from: source.id, to: target.id, via: write.device, guarded, physical: false });
        }
      }
      const deviceType = table.get(write.device)?.typeName;
      for (const effect of PHYSICAL_EFFECTS) {
        if (effect.deviceType !== deviceType || write.value !== effect.state) continue;
        for (const target of rules) {
          for (const name of triggerReads(target)) {
            if (table.get(name)?.typeName !== effect.sensorType) continue;
            const key = `${source.id}~${target.id}~${name}`;
            edges.set(key, { from: source.id, to: target.id, via: `${write.device} → ${name}`, guarded: true, physical: true });
          }
        }
      }
    }
  }

  const edgeList = [...edges.values()];
  return {
    nodes: rules.map((r) => ({ id: r.id, label: r.name ? `${r.id} ${r.name}` : r.id })),
    edges: edgeList,
    cycles: stronglyConnected(rules.map((r) => r.id), edgeList.filter((e) => !e.physical)),
  };
}

/**
 * Tarjan's algorithm. One depth-first search numbers each node and tracks the
 * lowest number reachable from it; a node whose low-link equals its own number
 * is the root of a strongly connected component.
 */
function stronglyConnected(ids: readonly string[], edges: readonly DepEdge[]): string[][] {
  const next = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) next.get(e.from)!.push(e.to);

  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (v: string): void => {
    index.set(v, counter);
    lowLink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);

    for (const w of next.get(v)!) {
      if (!index.has(w)) {
        visit(w);
        lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
      } else if (onStack.has(w)) {
        lowLink.set(v, Math.min(lowLink.get(v)!, index.get(w)!));
      }
    }

    if (lowLink.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      const selfLoop = next.get(v)!.includes(v);
      if (component.length > 1 || selfLoop) components.push(component.reverse());
    }
  };

  for (const id of ids) if (!index.has(id)) visit(id);
  return components;
}

/** One concrete cycle through a component, for the message. */
function cyclePath(component: readonly string[], edges: readonly DepEdge[]): string[] {
  const inside = new Set(component);
  const start = component[0]!;
  const path = [start];
  const seen = new Set([start]);
  let current = start;
  for (;;) {
    const options = edges.filter((e) => e.from === current && inside.has(e.to));
    const onward = options.find((e) => e.to === start && path.length > 1) ??
      options.find((e) => !seen.has(e.to)) ?? options.find((e) => e.to === start);
    if (!onward) return [...path, start];
    path.push(onward.to);
    if (onward.to === start) return path;
    seen.add(onward.to);
    current = onward.to;
  }
}

/** S317 when no edge of a cycle has a guard, W407 otherwise. */
export function loopDiagnostics(graph: DepGraph, program: Program): Diagnostic[] {
  const wiring = graph.edges.filter((e) => !e.physical);
  return graph.cycles.map((component) => {
    const inside = new Set(component);
    const internal = wiring.filter((e) => inside.has(e.from) && inside.has(e.to));
    const path = cyclePath(component, internal).join(' → ');
    const { span } = program.rules.find((r) => r.id === component[0])!;
    return internal.every((e) => !e.guarded)
      ? makeDiagnostic('S317', span, `Infinite loop: ${path} with no guarding condition.`)
      : makeDiagnostic('W407', span, `Possible loop ${path}; the runtime stops at depth 16.`);
  });
}

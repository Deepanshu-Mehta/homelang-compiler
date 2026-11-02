import { formatMinutes } from '../numeric';
import type { Action, Cond, DurationLit, Expr, Program, Rule, Trigger } from './ast';
import type { ViewNode } from './parseTree';

const EVENT_TEXT: Readonly<Record<string, string>> = {
  TURNS_ON: 'TURNS ON', TURNS_OFF: 'TURNS OFF', RISES_ABOVE: 'RISES ABOVE', FALLS_BELOW: 'FALLS BELOW',
};

export function exprText(e: Expr): string {
  switch (e.kind) {
    case 'NumLit':
    case 'TimeLit':
      return e.text;
    case 'EnumLit':
      return e.value;
    case 'Ref':
      return e.name;
    case 'Arith':
      return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`;
    case 'Neg':
      return `-${exprText(e.operand)}`;
  }
}

/** Parenthesises OR under AND so the text keeps the tree's meaning. */
export function condText(c: Cond): string {
  switch (c.kind) {
    case 'Logic': {
      const side = (x: Cond) =>
        c.op === 'AND' && x.kind === 'Logic' && x.op === 'OR' ? `(${condText(x)})` : condText(x);
      return `${side(c.left)} ${c.op} ${side(c.right)}`;
    }
    case 'Not':
      return c.operand.kind === 'Logic' ? `NOT (${condText(c.operand)})` : `NOT ${condText(c.operand)}`;
    case 'Compare':
      return `${exprText(c.left)} ${c.op} ${exprText(c.right)}`;
    case 'StateTest':
      return `${exprText(c.target)} IS ${c.negated ? 'NOT ' : ''}${c.state}`;
    case 'Between':
      return `${exprText(c.subject)} BETWEEN ${exprText(c.lo)} AND ${exprText(c.hi)}`;
    case 'BoolLit':
      return c.value ? 'TRUE' : 'FALSE';
  }
}

export function actionText(a: Action): string {
  switch (a.kind) {
    case 'Power':
      return `${a.op} ${a.target.name}`;
    case 'SetAttr':
      return `SET ${a.target.name} ${a.attr} TO ${exprText(a.value)}`;
    case 'Wait':
      return `WAIT ${a.duration.text}`;
    case 'Notify':
      return `NOTIFY "${a.text}"`;
    case 'IfAction':
      return `IF ${condText(a.cond)} THEN …`;
  }
}

function durationText(d: DurationLit | undefined): string {
  return d ? ` FOR ${d.text}` : '';
}

export function triggerText(t: Trigger): string {
  switch (t.kind) {
    case 'State':
      return `IF ${condText(t.cond)}${durationText(t.hold)}`;
    case 'Event': {
      const event = EVENT_TEXT[t.event] ?? t.event;
      const value = t.value ? ` ${exprText(t.value)}` : '';
      const guard = t.guard ? ` IF ${condText(t.guard)}` : '';
      return `WHEN ${t.source.name} ${event}${value}${guard}`;
    }
    case 'Time':
      return `AT ${formatMinutes(t.minutes)}${t.days ? ` ON ${t.days.join(', ')}` : ''}`;
  }
}

function actionLines(actions: readonly Action[], indent: string): string[] {
  return actions.flatMap((a) => {
    if (a.kind !== 'IfAction') return [indent + actionText(a)];
    return [
      `${indent}IF ${condText(a.cond)}`,
      `${indent}THEN`,
      ...actionLines(a.thenActs, `${indent}  `),
      ...(a.elseActs ? [`${indent}ELSE`, ...actionLines(a.elseActs, `${indent}  `)] : []),
      `${indent}END`,
    ];
  });
}

function ruleLines(rule: Rule): string[] {
  const name = rule.name ? ` "${rule.name}"` : '';
  return [
    `Rule ${rule.id}${name} (priority ${rule.priority})`,
    `  ${triggerText(rule.trigger)}`,
    '  THEN',
    ...actionLines(rule.thenActs, '    '),
    ...(rule.elseActs ? ['  ELSE', ...actionLines(rule.elseActs, '    ')] : []),
  ];
}

/** "The whole program as the parser sees it": structure, with no punctuation. */
export function programText(program: Program): string {
  const lines: string[] = [];
  for (const d of program.decls) {
    if (d.kind === 'RoomDecl') lines.push(`Room ${d.name}`);
    else if (d.kind === 'DeviceDecl') lines.push(`Device ${d.name} : ${d.typeName}${d.room ? ` in ${d.room}` : ''}`);
    else lines.push(`Sensor ${d.name} : ${d.typeName}${d.room ? ` in ${d.room}` : ''}${d.unit ? ` unit ${d.unit}` : ''}`);
  }
  for (const rule of program.rules) lines.push(...ruleLines(rule));
  if (program.sim) {
    lines.push('Simulate');
    for (const s of program.sim.stmts) {
      const assigns = s.assigns.map((a) => `${a.target.name} = ${exprText(a.value)}`).join(', ');
      lines.push(`  at ${formatMinutes(s.minutes)}: ${assigns}`);
    }
  }
  return lines.join('\n');
}

function tagged(label: string, tag: string | undefined, children: ViewNode[] = []): ViewNode {
  return tag ? { label, tag, children } : { label, children };
}

function exprView(e: Expr): ViewNode {
  switch (e.kind) {
    case 'NumLit':
      return tagged(`NumLit ${e.text}`, e.tag);
    case 'TimeLit':
      return tagged(`TimeLit ${e.text}`, e.tag);
    case 'EnumLit':
      return tagged(`EnumLit ${e.value}`, e.tag);
    case 'Ref':
      return tagged(`Ref ${e.name}`, e.tag);
    case 'Arith':
      return tagged(`Arith(${e.op})`, e.tag, [exprView(e.left), exprView(e.right)]);
    case 'Neg':
      return tagged('Neg', e.tag, [exprView(e.operand)]);
  }
}

function condView(c: Cond): ViewNode {
  switch (c.kind) {
    case 'Logic':
      return { label: c.op, children: [condView(c.left), condView(c.right)] };
    case 'Not':
      return { label: 'Not', children: [condView(c.operand)] };
    case 'Compare':
      return { label: `Compare(${c.op})`, children: [exprView(c.left), exprView(c.right)] };
    case 'StateTest':
      return { label: `StateTest(${c.negated ? 'IS NOT' : 'IS'} ${c.state})`, children: [exprView(c.target)] };
    case 'Between':
      return { label: 'Between', children: [exprView(c.subject), exprView(c.lo), exprView(c.hi)] };
    case 'BoolLit':
      return { label: `BoolLit ${c.value}`, children: [] };
  }
}

function actionView(a: Action): ViewNode {
  switch (a.kind) {
    case 'Power':
      return { label: `Power(${a.op})`, children: [exprView(a.target)] };
    case 'SetAttr':
      return { label: `SetAttr(${a.attr})`, children: [exprView(a.target), exprView(a.value)] };
    case 'Wait':
      return { label: `Wait ${a.duration.text}`, children: [] };
    case 'Notify':
      return { label: `Notify "${a.text}"`, children: [] };
    case 'IfAction':
      return {
        label: 'IfAction',
        children: [
          condView(a.cond),
          { label: 'then', children: a.thenActs.map(actionView) },
          ...(a.elseActs ? [{ label: 'else', children: a.elseActs.map(actionView) }] : []),
        ],
      };
  }
}

function triggerView(t: Trigger): ViewNode {
  switch (t.kind) {
    case 'State':
      return {
        label: `StateTrigger${t.hold ? ` hold ${t.hold.text}` : ''}`,
        children: [condView(t.cond)],
      };
    case 'Event':
      return {
        label: `EventTrigger ${t.event}`,
        children: [
          exprView(t.source),
          ...(t.value ? [exprView(t.value)] : []),
          ...(t.guard ? [condView(t.guard)] : []),
        ],
      };
    case 'Time':
      return { label: `TimeTrigger ${formatMinutes(t.minutes)}${t.days ? ` ${t.days.join(',')}` : ''}`, children: [] };
  }
}

/** The AST as a tree the UI can draw, with annotations as tags. */
export function astToView(program: Program): ViewNode {
  return {
    label: 'Program',
    children: [
      ...(program.decls.length ? [{
        label: `Declarations (${program.decls.length})`,
        startCollapsed: true,
        children: program.decls.map((d): ViewNode => ({
          label: d.kind === 'RoomDecl' ? `Room ${d.name}` : `${d.kind === 'DeviceDecl' ? 'Device' : 'Sensor'} ${d.name} : ${d.typeName}`,
          children: [],
        })),
      }] : []),
      ...program.rules.map((r): ViewNode => ({
        label: `Rule ${r.id} (priority ${r.priority})`,
        children: [
          triggerView(r.trigger),
          { label: 'then', children: r.thenActs.map(actionView) },
          ...(r.elseActs ? [{ label: 'else', children: r.elseActs.map(actionView) }] : []),
        ],
      })),
      ...(program.sim ? [{ label: `Simulation (${program.sim.stmts.length} steps)`, children: [] }] : []),
    ],
  };
}

import type {
  Action, Cond, Expr, ParserOutput, Program, Rule, Token,
} from '../compiler/index';
import { formatMinutes } from '../compiler/index';

/** Colours and shapes follow the kind, and the legend names each one. */
export type TreeKind = 'structure' | 'trigger' | 'condition' | 'action' | 'value' | 'rule' | 'token';

export interface SourceSpan {
  start: number;
  end: number;
}

export interface TreeNode {
  /** Stable path: "0.2.1" is child 1 of child 2 of the root. */
  id: string;
  /** Lets a node keep its identity across the parse tree and AST toggle. */
  morphKey: string;
  label: string;
  tag?: string;
  kind: TreeKind;
  /** For tokens: the token class, which sets the colour. */
  category?: Token['category'];
  span?: SourceSpan;
  startCollapsed?: boolean;
  children: TreeNode[];
}

type Draft = Omit<TreeNode, 'id' | 'morphKey' | 'children'> & { children?: Draft[] };

const spanOf = ({ start, end }: { start: number; end: number }): SourceSpan => ({ start, end });

function union(nodes: readonly Draft[]): SourceSpan | undefined {
  const spans = nodes.flatMap((n) => n.span ?? []);
  if (spans.length === 0) return undefined;
  return { start: Math.min(...spans.map((s) => s.start)), end: Math.max(...spans.map((s) => s.end)) };
}

function group(label: string, kind: TreeKind, children: Draft[], extra: Partial<Draft> = {}): Draft {
  const span = union(children);
  return { label, kind, children, ...(span && { span }), ...extra };
}

function exprNode(e: Expr): Draft {
  const base = { kind: 'value' as const, span: spanOf(e.span), ...(e.tag && { tag: e.tag }) };
  switch (e.kind) {
    case 'NumLit':
      return { ...base, label: `NumLit ${e.text}` };
    case 'TimeLit':
      return { ...base, label: `TimeLit ${e.text}` };
    case 'EnumLit':
      return { ...base, label: `EnumLit ${e.value}` };
    case 'Ref':
      return { ...base, label: `Ref ${e.name}` };
    case 'Arith':
      return { ...base, label: `Arith(${e.op})`, children: [exprNode(e.left), exprNode(e.right)] };
    case 'Neg':
      return { ...base, label: 'Neg', children: [exprNode(e.operand)] };
  }
}

function condNode(c: Cond): Draft {
  const base = { kind: 'condition' as const, span: spanOf(c.span) };
  switch (c.kind) {
    case 'Logic':
      return { ...base, label: c.op, children: [condNode(c.left), condNode(c.right)] };
    case 'Not':
      return { ...base, label: 'Not', children: [condNode(c.operand)] };
    case 'Compare':
      return { ...base, label: `Compare(${c.op})`, children: [exprNode(c.left), exprNode(c.right)] };
    case 'StateTest':
      return { ...base, label: `StateTest(${c.negated ? 'IS NOT' : 'IS'} ${c.state})`, children: [exprNode(c.target)] };
    case 'Between':
      return { ...base, label: 'Between', children: [exprNode(c.subject), exprNode(c.lo), exprNode(c.hi)] };
    case 'BoolLit':
      return { ...base, label: `BoolLit ${c.value}` };
  }
}

function actionNode(a: Action): Draft {
  const base = { kind: 'action' as const, span: spanOf(a.span) };
  switch (a.kind) {
    case 'Power':
      return { ...base, label: `Power(${a.op})`, children: [exprNode(a.target)] };
    case 'SetAttr':
      return { ...base, label: `SetAttr(${a.attr})`, children: [exprNode(a.target), exprNode(a.value)] };
    case 'Wait':
      return { ...base, label: `Wait ${a.duration.text}` };
    case 'Notify':
      return { ...base, label: `Notify "${a.text}"` };
    case 'IfAction':
      return {
        ...base, label: 'IfAction',
        children: [
          condNode(a.cond),
          group('then', 'structure', a.thenActs.map(actionNode)),
          ...(a.elseActs ? [group('else', 'structure', a.elseActs.map(actionNode))] : []),
        ],
      };
  }
}

function triggerNode(rule: Rule): Draft {
  const { trigger } = rule;
  switch (trigger.kind) {
    case 'State':
      return group(`StateTrigger${trigger.hold ? ` hold ${trigger.hold.text}` : ''}`, 'trigger', [condNode(trigger.cond)]);
    case 'Event':
      return {
        label: `EventTrigger ${trigger.event}`, kind: 'trigger', span: spanOf(trigger.span),
        children: [
          exprNode(trigger.source),
          ...(trigger.value ? [exprNode(trigger.value)] : []),
          ...(trigger.guard ? [condNode(trigger.guard)] : []),
        ],
      };
    case 'Time':
      return {
        label: `TimeTrigger ${formatMinutes(trigger.minutes)}${trigger.days ? ` ${trigger.days.join(',')}` : ''}`,
        kind: 'trigger', span: spanOf(trigger.span),
      };
  }
}

function ruleNode(rule: Rule): Draft {
  return {
    label: `Rule ${rule.id} (priority ${rule.priority})`, kind: 'structure', span: spanOf(rule.span),
    children: [
      triggerNode(rule),
      group('then', 'structure', rule.thenActs.map(actionNode)),
      ...(rule.elseActs ? [group('else', 'structure', rule.elseActs.map(actionNode))] : []),
    ],
  };
}

function declNode(d: Program['decls'][number]): Draft {
  const label = d.kind === 'RoomDecl'
    ? `Room ${d.name}`
    : `${d.kind === 'DeviceDecl' ? 'Device' : 'Sensor'} ${d.name} : ${d.typeName}`;
  return { label, kind: 'value', span: spanOf(d.span) };
}

/**
 * The AST as a drawable tree. The same function serves the parser's AST and the
 * annotated AST: only the annotated one has `tag` values to show.
 */
export function astTree(program: Program): TreeNode {
  const children: Draft[] = [];
  if (program.decls.length) {
    children.push(group(`Declarations (${program.decls.length})`, 'structure', program.decls.map(declNode), { startCollapsed: true }));
  }
  // Rules sit side by side, so only the first starts open. Otherwise a program
  // of several rules opens as a tree far wider than the view.
  children.push(...program.rules.map((rule, i) => ({ ...ruleNode(rule), ...(i > 0 && { startCollapsed: true }) })));
  if (program.sim) {
    children.push({ label: `Simulation (${program.sim.stmts.length} steps)`, kind: 'structure', span: spanOf(program.sim.span) });
  }
  return finish(group('Program', 'structure', children));
}

/** Leaves appear in token order, so the nth leaf is the nth token. */
export function parseTree(output: ParserOutput, tokens: readonly Token[]): TreeNode {
  let nextToken = 0;
  const visit = (node: ParserOutput['parseTree']['children'][number]): Draft => {
    if (node.kind === 'leaf') {
      const token = tokens[nextToken++];
      return {
        label: node.lexeme || 'EOF', tag: node.tokenType, kind: 'token',
        ...(token && { category: token.category, span: spanOf(token.span) }),
      };
    }
    return group(node.name, 'rule', node.children.map(visit));
  };
  return finish(visit(output.parseTree));
}

/**
 * Gives each node its id and morph key. Several nested nodes can cover the same
 * text, as `value`, `term` and `factor` do. Only the deepest takes the shared
 * key, which is the one that lines up with the AST node for that text.
 */
function finish(draft: Draft): TreeNode {
  const deepest = new Map<string, string>();
  const claim = (node: Draft, id: string): void => {
    if (node.span) deepest.set(`${node.span.start}:${node.span.end}`, id);
    node.children?.forEach((child, i) => claim(child, `${id}.${i}`));
  };
  claim(draft, '0');

  const build = (node: Draft, id: string): TreeNode => {
    const shared = node.span ? `${node.span.start}:${node.span.end}` : undefined;
    const { children, ...rest } = node;
    return {
      ...rest, id,
      morphKey: shared && deepest.get(shared) === id ? shared : `only:${id}`,
      children: (children ?? []).map((child, i) => build(child, `${id}.${i}`)),
    };
  };
  return build(draft, '0');
}

export function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** The path from the root to the deepest node covering a source position. */
export function pathToPosition(root: TreeNode, position: number): TreeNode[] {
  const covers = (n: TreeNode) => n.span && position >= n.span.start && position < Math.max(n.span.end, n.span.start + 1);
  const path: TreeNode[] = [root];
  for (;;) {
    const next = path[path.length - 1]!.children.find(covers);
    if (!next) return path;
    path.push(next);
  }
}

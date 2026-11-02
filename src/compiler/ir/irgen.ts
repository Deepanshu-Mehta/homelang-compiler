import { type UnitName } from '../lexer/units';
import type { Action, Cond, Expr, Program, Rule } from '../parser/ast';
import { quadText, type Conversion, type Operand, type Quad } from './quads';

/** Listings start at 100, as in plan.txt §6, and run on across rules. */
export const FIRST_INDEX = 100;

export interface Routine {
  ruleId: string;
  /** First quad, and one past the last. */
  start: number;
  end: number;
}

export interface IrProgram {
  quads: Quad[];
  routines: Routine[];
}

/** One frame of the backpatching animation. */
export interface IrStep {
  /** How many quads exist at this point. */
  emitted: number;
  /** Jumps filled in by this step. */
  patched: number[];
  target?: number;
  note: string;
}

interface Jumps {
  truelist: number[];
  falselist: number[];
}

type NewQuad = Quad extends infer Q ? (Q extends Quad ? Omit<Q, 'index' | 'ruleId'> : never) : never;

const CONVERSIONS: Partial<Record<UnitName, Conversion>> = {
  F: 'F_TO_C', MIN: 'MIN_TO_S', H: 'H_TO_S',
};

const constant = (value: number | string): Operand => ({ kind: 'const', value });
const originOf = ({ origin }: { origin?: string }) => (origin ? { origin } : {});

/**
 * One-pass lowering with backpatching (Dragon Book §6.7). A jump is emitted with
 * an unknown target and its index goes on a truelist or falselist; `backpatch`
 * fills the targets once the label is known. AND, OR and NOT therefore produce
 * no instructions of their own, only jumps: this is short-circuit evaluation.
 */
class IrGenerator {
  private readonly quads: Quad[] = [];
  private readonly routines: Routine[] = [];
  readonly steps: IrStep[] = [];
  private temp = 0;
  private ruleId = '';

  private get next(): number {
    return FIRST_INDEX + this.quads.length;
  }

  private emit(quad: NewQuad): number {
    const index = this.next;
    this.quads.push({ ...quad, index, ruleId: this.ruleId } as Quad);
    this.steps.push({ emitted: this.quads.length, patched: [], note: `emit ${quadText(this.quads[this.quads.length - 1]!)}` });
    return index;
  }

  private newTemp(): string {
    this.temp++;
    return `t${this.temp}`;
  }

  /** Dragon Book §6.7: backpatch(p, i) inserts i as the target of every jump on p. */
  private backpatch(list: readonly number[], target: number, why: string): void {
    if (list.length === 0) return;
    for (const index of list) {
      const quad = this.quads[index - FIRST_INDEX]!;
      if (quad.kind === 'if' || quad.kind === 'ifIn' || quad.kind === 'goto') quad.target = target;
    }
    this.steps.push({
      emitted: this.quads.length, patched: [...list], target,
      note: `backpatch({${list.join(', ')}}, ${target}): ${why}`,
    });
  }

  program(ast: Program): { program: IrProgram; steps: IrStep[] } {
    for (const rule of ast.rules) this.rule(rule);
    return { program: { quads: this.quads, routines: this.routines }, steps: this.steps };
  }

  private rule(rule: Rule): void {
    this.ruleId = rule.id;
    const start = this.next;
    const { trigger } = rule;
    if (trigger.kind === 'State') {
      this.stateRule(trigger.cond, trigger.hold?.seconds ?? 0, rule);
    } else if (trigger.kind === 'Event' && trigger.guard) {
      this.guardedRule(trigger.guard, rule);
    } else {
      this.actions(rule.thenActs);
      this.emit({ kind: 'ret' });
    }
    this.routines.push({ ruleId: rule.id, start, end: this.next });
  }

  private stateRule(cond: Cond, hold: number, rule: Rule): void {
    const jumps = this.condition(cond);
    const thenStart = this.next;
    this.backpatch(jumps.truelist, thenStart, 'the condition is true, so go to the edge check for THEN');
    this.emit({ kind: 'edgeTrue', hold });
    this.actions(rule.thenActs);
    this.emit({ kind: 'ret' });

    const elseStart = this.next;
    this.backpatch(jumps.falselist, elseStart, 'the condition is false, so go to the edge check for ELSE');
    this.emit({ kind: 'edgeFalse' });
    if (rule.elseActs) this.actions(rule.elseActs);
    this.emit({ kind: 'ret' });
  }

  private guardedRule(guard: Cond, rule: Rule): void {
    const jumps = this.condition(guard);
    this.backpatch(jumps.truelist, this.next, 'the guard holds, so run the actions');
    this.actions(rule.thenActs);
    this.backpatch(jumps.falselist, this.next, 'the guard fails, so skip the actions');
    this.emit({ kind: 'ret' });
  }

  private actions(actions: readonly Action[]): void {
    for (const action of actions) {
      switch (action.kind) {
        case 'Power':
          this.emit({ kind: 'call', op: action.op, device: action.target.name, ...originOf(action) });
          break;
        case 'SetAttr':
          this.emit({ kind: 'set', device: action.target.name, attr: action.attr, value: this.expr(action.value), ...originOf(action) });
          break;
        case 'Wait': {
          const { value, unit } = action.duration;
          this.emit({ kind: 'wait', seconds: this.literal(value, unit) });
          break;
        }
        case 'Notify':
          this.emit({ kind: 'notify', text: action.text, ...originOf(action) });
          break;
        case 'IfAction':
          this.nestedIf(action);
          break;
      }
    }
  }

  private nestedIf(action: Extract<Action, { kind: 'IfAction' }>): void {
    const jumps = this.condition(action.cond);
    this.backpatch(jumps.truelist, this.next, 'nested IF: run the THEN actions');
    this.actions(action.thenActs);
    if (!action.elseActs) {
      this.backpatch(jumps.falselist, this.next, 'nested IF: skip the THEN actions');
      return;
    }
    const skip = this.emit({ kind: 'goto', target: null });
    this.backpatch(jumps.falselist, this.next, 'nested IF: run the ELSE actions');
    this.actions(action.elseActs);
    this.backpatch([skip], this.next, 'nested IF: THEN jumps over ELSE');
  }

  /** B → E1 relop E2 and friends: every condition leaves two lists of jumps. */
  private condition(cond: Cond): Jumps {
    switch (cond.kind) {
      case 'Logic':
        return cond.op === 'AND' ? this.andCond(cond.left, cond.right) : this.orCond(cond.left, cond.right);
      case 'Not': {
        // B → NOT B1: swap the lists, with no instruction emitted.
        const inner = this.condition(cond.operand);
        return { truelist: inner.falselist, falselist: inner.truelist };
      }
      case 'BoolLit': {
        const jump = this.emit({ kind: 'goto', target: null });
        return cond.value ? { truelist: [jump], falselist: [] } : { truelist: [], falselist: [jump] };
      }
      case 'Compare':
        return this.relation(this.expr(cond.left), cond.op, this.expr(cond.right));
      case 'StateTest': {
        const jumps = this.relation(this.expr(cond.target), '==', constant(cond.state));
        return cond.negated ? { truelist: jumps.falselist, falselist: jumps.truelist } : jumps;
      }
      case 'Between':
        return this.between(cond);
    }
  }

  /** B → B1 AND M B2: backpatch(B1.truelist, M.instr). */
  private andCond(left: Cond, right: Cond): Jumps {
    const first = this.condition(left);
    const marker = this.next;
    const second = this.condition(right);
    this.backpatch(first.truelist, marker, 'B → B1 AND M B2: if B1 is true, go on to test B2');
    return { truelist: second.truelist, falselist: [...first.falselist, ...second.falselist] };
  }

  /** B → B1 OR M B2: backpatch(B1.falselist, M.instr). */
  private orCond(left: Cond, right: Cond): Jumps {
    const first = this.condition(left);
    const marker = this.next;
    const second = this.condition(right);
    this.backpatch(first.falselist, marker, 'B → B1 OR M B2: if B1 is false, go on to test B2');
    return { truelist: [...first.truelist, ...second.truelist], falselist: second.falselist };
  }

  private relation(a: Operand, relop: Extract<Quad, { kind: 'if' }>['relop'], b: Operand): Jumps {
    const test = this.emit({ kind: 'if', relop, a, b, target: null, negate: false });
    const otherwise = this.emit({ kind: 'goto', target: null });
    return { truelist: [test], falselist: [otherwise] };
  }

  private between(cond: Extract<Cond, { kind: 'Between' }>): Jumps {
    const subject = this.expr(cond.subject);
    const lo = cond.lo.constant;
    const hi = cond.hi.constant;
    if (cond.subject.valueType?.kind === 'time' && typeof lo === 'number' && typeof hi === 'number') {
      const test = this.emit({ kind: 'ifIn', a: subject, lo, hi, target: null, negate: false });
      const otherwise = this.emit({ kind: 'goto', target: null });
      return { truelist: [test], falselist: [otherwise] };
    }
    // Numeric BETWEEN is inclusive: lo <= x AND x <= hi, reading x only once.
    const low = this.relation(subject, '>=', this.expr(cond.lo));
    this.backpatch(low.truelist, this.next, 'BETWEEN: above the lower limit, so test the upper limit');
    const high = this.relation(subject, '<=', this.expr(cond.hi));
    return { truelist: high.truelist, falselist: [...low.falselist, ...high.falselist] };
  }

  private literal(value: number, unit: UnitName | undefined): Operand {
    const conversion = unit && CONVERSIONS[unit];
    if (!conversion) return constant(value);
    const t = this.newTemp();
    this.emit({ kind: 'cvt', t, conversion, a: constant(value) });
    return { kind: 'temp', name: t };
  }

  private expr(e: Expr): Operand {
    switch (e.kind) {
      case 'NumLit':
        return this.literal(e.value, e.unit);
      case 'TimeLit': {
        const t = this.newTemp();
        this.emit({ kind: 'cvt', t, conversion: 'TIME_TO_MIN', a: constant(e.text) });
        return { kind: 'temp', name: t };
      }
      case 'EnumLit':
        return constant(e.value);
      case 'Ref': {
        const t = this.newTemp();
        this.emit({ kind: 'load', t, name: e.name });
        return { kind: 'temp', name: t };
      }
      case 'Neg': {
        const a = this.expr(e.operand);
        const t = this.newTemp();
        this.emit({ kind: 'neg', t, a });
        return { kind: 'temp', name: t };
      }
      case 'Arith': {
        // Literal time arithmetic is already a plain minute count.
        if (e.valueType?.kind === 'time' && typeof e.constant === 'number') return constant(e.constant);
        const a = this.expr(e.left);
        const b = this.expr(e.right);
        const t = this.newTemp();
        this.emit({ kind: 'arith', t, op: e.op, a, b });
        return { kind: 'temp', name: t };
      }
    }
  }
}

export function generateIr(ast: Program): { program: IrProgram; steps: IrStep[] } {
  return new IrGenerator().program(ast);
}


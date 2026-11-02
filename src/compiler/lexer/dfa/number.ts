import type { Dfa } from './types';

/**
 * q4 reads every identifier character plus % and °, so the whole suffix reaches
 * the unit table. `30CTHEN` therefore has the suffix CTHEN, which is L106.
 * q5 has no edge on a non-digit: that dead end is the `PRIORITY 2:` rollback.
 */
export const numberDfa: Dfa = {
  name: 'number',
  title: 'Numbers, quantities and times',
  start: 'q0',
  width: 760,
  height: 300,
  states: [
    { id: 'q0', x: 50, y: 140 },
    { id: 'q1', accept: 'NUMBER', label: 'NUMBER', x: 180, y: 140 },
    { id: 'q2', label: 'after .', x: 330, y: 50 },
    { id: 'q3', accept: 'NUMBER', label: 'NUMBER', x: 480, y: 50 },
    { id: 'q4', accept: 'QUANTITY', label: 'QUANTITY', x: 640, y: 140 },
    { id: 'q5', label: 'after :', x: 180, y: 250 },
    { id: 'q6', label: '1 minute digit', x: 340, y: 250 },
    { id: 'q7', accept: 'TIME_LIT', label: 'TIME_LIT', x: 500, y: 250 },
  ],
  edges: [
    { from: 'q0', on: ['digit'], to: 'q1', label: 'digit' },
    { from: 'q1', on: ['digit'], to: 'q1', label: 'digit' },
    { from: 'q1', on: ['dot'], to: 'q2', label: '.' },
    { from: 'q1', on: ['colon'], to: 'q5', label: ':' },
    { from: 'q1', on: ['letter', 'underscore', 'percent', 'degree'], to: 'q4', label: 'unit char' },
    { from: 'q2', on: ['digit'], to: 'q3', label: 'digit' },
    { from: 'q2', on: ['else'], error: 'L103', label: 'L103' },
    { from: 'q3', on: ['digit'], to: 'q3', label: 'digit' },
    { from: 'q3', on: ['dot'], error: 'L104', label: 'L104' },
    { from: 'q3', on: ['letter', 'underscore', 'percent', 'degree'], to: 'q4', label: 'unit char' },
    { from: 'q4', on: ['letter', 'digit', 'underscore', 'percent', 'degree'], to: 'q4', label: 'unit char, digit' },
    { from: 'q5', on: ['digit'], to: 'q6', label: 'digit' },
    { from: 'q6', on: ['digit'], to: 'q7', label: 'digit' },
    { from: 'q6', on: ['else'], error: 'L105', label: 'L105' },
    { from: 'q7', on: ['digit', 'letter', 'underscore', 'percent', 'degree'], error: 'L105', label: 'L105' },
  ],
};

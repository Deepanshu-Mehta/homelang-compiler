import type { Dfa } from './types';

export const relopDfa: Dfa = {
  name: 'relop',
  title: 'Relational operators',
  start: 'q0',
  width: 420,
  height: 340,
  states: [
    { id: 'q0', x: 50, y: 170 },
    { id: 'q1', accept: 'GT', label: 'GT', x: 190, y: 50 },
    { id: 'q2', accept: 'GE', label: 'GE', x: 350, y: 50 },
    { id: 'q3', accept: 'LT', label: 'LT', x: 190, y: 130 },
    { id: 'q4', accept: 'LE', label: 'LE', x: 350, y: 130 },
    { id: 'q5', accept: 'ASSIGN', label: 'ASSIGN', x: 190, y: 210 },
    { id: 'q6', accept: 'EQ', label: 'EQ', x: 350, y: 210 },
    { id: 'q7', x: 190, y: 290 },
    { id: 'q8', accept: 'NE', label: 'NE', x: 350, y: 290 },
  ],
  edges: [
    { from: 'q0', on: ['gt'], to: 'q1', label: '>' },
    { from: 'q0', on: ['lt'], to: 'q3', label: '<' },
    { from: 'q0', on: ['eq'], to: 'q5', label: '=' },
    { from: 'q0', on: ['bang'], to: 'q7', label: '!' },
    { from: 'q1', on: ['eq'], to: 'q2', label: '=' },
    { from: 'q3', on: ['eq'], to: 'q4', label: '=' },
    { from: 'q5', on: ['eq'], to: 'q6', label: '=' },
    { from: 'q7', on: ['eq'], to: 'q8', label: '=' },
    { from: 'q7', on: ['else'], error: 'L102', label: 'L102' },
  ],
};

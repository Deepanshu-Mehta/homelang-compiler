import type { Dfa } from './types';

export const stringDfa: Dfa = {
  name: 'string',
  title: 'Strings',
  start: 'q0',
  width: 480,
  height: 190,
  states: [
    { id: 'q0', x: 50, y: 70 },
    { id: 'q1', label: 'inside', x: 200, y: 70 },
    { id: 'q2', label: 'escape', x: 200, y: 160 },
    { id: 'q3', accept: 'STRING', label: 'STRING', x: 400, y: 70 },
  ],
  edges: [
    { from: 'q0', on: ['quote'], to: 'q1', label: '"' },
    { from: 'q1', on: ['quote'], to: 'q3', label: '"' },
    { from: 'q1', on: ['backslash'], to: 'q2', label: '\\' },
    { from: 'q1', on: ['newline', 'eof'], error: 'L108', label: 'L108' },
    { from: 'q1', on: ['else'], to: 'q1', label: 'any' },
    { from: 'q2', on: ['newline', 'eof'], error: 'L108', label: 'L108' },
    { from: 'q2', on: ['else'], to: 'q1', label: 'any' },
  ],
};

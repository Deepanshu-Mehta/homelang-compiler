import type { Dfa } from './types';

export const identDfa: Dfa = {
  name: 'ident',
  title: 'Identifiers and keywords',
  start: 'q0',
  width: 330,
  height: 120,
  states: [
    { id: 'q0', x: 60, y: 60 },
    { id: 'q1', accept: 'IDENT', label: 'WORD', x: 230, y: 60 },
  ],
  edges: [
    { from: 'q0', on: ['letter', 'underscore'], to: 'q1', label: 'letter _' },
    { from: 'q1', on: ['letter', 'digit', 'underscore'], to: 'q1', label: 'letter digit _' },
  ],
};

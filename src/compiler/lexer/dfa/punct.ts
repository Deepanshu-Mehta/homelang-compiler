import type { Dfa } from './types';

export const punctDfa: Dfa = {
  name: 'punct',
  title: 'Punctuation',
  start: 'q0',
  width: 330,
  height: 110,
  states: [
    { id: 'q0', x: 60, y: 50 },
    { id: 'q1', accept: 'PUNCT', label: 'by character', x: 240, y: 50 },
  ],
  edges: [
    { from: 'q0', on: ['punct', 'star', 'colon', 'percent'], to: 'q1', label: '+ - * % ( ) { } , ; :' },
  ],
};

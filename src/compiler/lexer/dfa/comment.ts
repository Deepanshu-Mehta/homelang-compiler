import type { Dfa } from './types';

/** Block comments do not nest: the first closing star-slash ends the comment. */
export const commentDfa: Dfa = {
  name: 'comment',
  title: 'Comments and division',
  start: 'q0',
  width: 620,
  height: 220,
  states: [
    { id: 'q0', x: 50, y: 70 },
    { id: 'q1', accept: 'SLASH', label: 'SLASH', x: 180, y: 70 },
    { id: 'q2', accept: 'COMMENT', label: 'line comment', x: 330, y: 40 },
    { id: 'q3', label: 'block body', x: 330, y: 170 },
    { id: 'q4', label: 'after *', x: 470, y: 170 },
    { id: 'q5', accept: 'COMMENT', label: 'block comment', x: 570, y: 70 },
  ],
  edges: [
    { from: 'q0', on: ['slash'], to: 'q1', label: '/' },
    { from: 'q1', on: ['slash'], to: 'q2', label: '/' },
    { from: 'q1', on: ['star'], to: 'q3', label: '*' },
    { from: 'q2', on: ['newline', 'eof'], label: '' },
    { from: 'q2', on: ['else'], to: 'q2', label: 'not newline' },
    { from: 'q3', on: ['star'], to: 'q4', label: '*' },
    { from: 'q3', on: ['eof'], error: 'L109', label: 'L109' },
    { from: 'q3', on: ['else'], to: 'q3', label: 'any' },
    { from: 'q4', on: ['slash'], to: 'q5', label: '/' },
    { from: 'q4', on: ['star'], to: 'q4', label: '*' },
    { from: 'q4', on: ['eof'], error: 'L109', label: 'L109' },
    { from: 'q4', on: ['else'], to: 'q3', label: 'any' },
  ],
};

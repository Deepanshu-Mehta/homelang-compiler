import { createContext } from 'preact';
import type { SourceSpan } from './trees';

/** Connects trees to the editor, in both directions. */
export interface SpanLinkState {
  /** Hovering a node highlights its text in the editor. */
  setHoverSpan: (span: SourceSpan | null) => void;
  /** Clicking in the editor selects the deepest node at that position. */
  pickedPosition: number | null;
}

export const SpanLink = createContext<SpanLinkState>({ setHoverSpan: () => {}, pickedPosition: null });

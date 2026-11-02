import type { Token } from '../lexer/tokens';

/** A concrete parse tree keeps every grammar step, unlike the AST. */
export interface ParseNode {
  kind: 'node';
  name: string;
  children: ParseChild[];
}

export interface ParseLeaf {
  kind: 'leaf';
  tokenType: Token['type'];
  lexeme: string;
}

export type ParseChild = ParseNode | ParseLeaf;

/** One entry per nonterminal entered, for stepping through the grammar card. */
export interface ParseStep {
  rule: string;
  tokenIndex: number;
  depth: number;
}

/** A tree shape the UI can draw for both the parse tree and the AST. */
export interface ViewNode {
  label: string;
  /** Coloured tag on the annotated AST, such as a type or unit. */
  tag?: string;
  /** Draw this node folded at first. */
  startCollapsed?: boolean;
  children: ViewNode[];
}

export function parseTreeToView(node: ParseChild): ViewNode {
  if (node.kind === 'leaf') return { label: node.lexeme || 'EOF', tag: node.tokenType, children: [] };
  return { label: node.name, children: node.children.map(parseTreeToView) };
}

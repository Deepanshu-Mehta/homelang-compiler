import type { Span } from './diagnostics';

/**
 * Converts character offsets into 1-based line/column positions.
 * Only '\n' starts a new line, so '\r\n' counts as a single newline and a tab
 * counts as one column.
 */
export class SourceMap {
  private readonly lineStarts: number[] = [0];

  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') this.lineStarts.push(i + 1);
    }
  }

  span(start: number, end: number): Span {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.lineStarts[mid]! <= start) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: start - this.lineStarts[lo]! + 1, start, end };
  }

  /** The text of a 1-based line, without its line ending. */
  lineText(line: number): string {
    const from = this.lineStarts[line - 1] ?? 0;
    const to = this.lineStarts[line] ?? this.text.length;
    return this.text.slice(from, to).replace(/\r?\n$/, '');
  }
}

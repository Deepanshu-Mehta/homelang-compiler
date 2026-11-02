const MAX_LINES = 400;

interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** Numbered IR lines would all look changed, so numbers are ignored when matching. */
const withoutNumber = (line: string): string => line.replace(/^\d+ /, '').replace(/goto \d+/, 'goto');

/** Longest common subsequence diff: the classic dynamic program. */
function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const a = before.map(withoutNumber);
  const b = after.map(withoutNumber);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: after[j]! });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      lines.push({ kind: 'added', text: after[j]! });
      j++;
    } else {
      lines.push({ kind: 'removed', text: before[i]! });
      i++;
    }
  }
  return lines;
}

const SIGN = { same: ' ', removed: '-', added: '+' };

export function DiffView({ before, after }: { before: readonly string[]; after: readonly string[] }) {
  if (before.length > MAX_LINES || after.length > MAX_LINES) {
    return <p class="muted small">This listing is too long to compare here.</p>;
  }
  return (
    <pre class="diff" data-testid="diff">
      {diffLines(before, after).map((line, i) => (
        <span key={i} class={`diff-${line.kind}`}>{SIGN[line.kind]} {line.text}{'\n'}</span>
      ))}
    </pre>
  );
}

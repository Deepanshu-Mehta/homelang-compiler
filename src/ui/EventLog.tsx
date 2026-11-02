import { useEffect, useRef } from 'preact/hooks';
import type { LogEntry } from '../compiler/index';

interface EventLogProps {
  entries: readonly LogEntry[];
  /** Highlights a rule's line in the editor. */
  onLine: (line: number) => void;
  onHover: (entry: LogEntry | null) => void;
  id: string;
}

export function EventLog({ entries, onLine, onHover, id }: EventLogProps) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length]);

  if (entries.length === 0) return <p class="muted small">Nothing has happened yet.</p>;
  return (
    <ol class="event-log" ref={list} data-testid={`${id}-event-log`}>
      {entries.map((entry, i) => (
        <li key={i} class={`log-${entry.kind} ${entry.line ? 'is-linked' : ''}`} data-testid="log-entry"
          onClick={entry.line ? () => onLine(entry.line!) : undefined}
          onMouseEnter={() => onHover(entry)} onMouseLeave={() => onHover(null)}>
          <span class="log-time">{entry.time}</span> {entry.text}
        </li>
      ))}
    </ol>
  );
}

import { useEffect, useRef } from 'preact/hooks';
import type { LogEntry, LogKind } from '../compiler/index';
import { CheckIcon, CrossIcon, DashIcon, WarnIcon } from './icons';

interface EventLogProps {
  entries: readonly LogEntry[];
  /** Highlights a rule's line in the editor. */
  onLine: (line: number) => void;
  onHover: (entry: LogEntry | null) => void;
  id: string;
}

function KindIcon({ kind }: { kind: LogKind }) {
  if (kind === 'fired') return <CheckIcon />;
  if (kind === 'error') return <CrossIcon />;
  if (kind === 'warning' || kind === 'override' || kind === 'busy') return <WarnIcon />;
  return <DashIcon />;
}

/** The newest line stays in view, because it's the one that just happened. */
export function EventLog({ entries, onLine, onHover, id }: EventLogProps) {
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length]);

  const quiet = !entries.some((entry) => entry.kind === 'fired');
  return (
    <ol class="event-log" ref={list} data-testid={`${id}-event-log`}>
      {entries.map((entry, i) => (
        <li key={i} class={`log-${entry.kind} ${entry.line ? 'is-linked' : ''}`} data-testid="log-entry"
          onClick={entry.line ? () => onLine(entry.line!) : undefined}
          onMouseEnter={() => onHover(entry)} onMouseLeave={() => onHover(null)}>
          <span class="log-time">{entry.time}</span>
          <span class="log-icon"><KindIcon kind={entry.kind} /></span>
          <span class="log-text">{entry.text}</span>
        </li>
      ))}
      {quiet && <li class="log-hint" data-testid="first-run">No rule has fired yet. Move a slider, or choose Load an example…</li>}
    </ol>
  );
}

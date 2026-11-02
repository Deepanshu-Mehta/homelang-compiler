import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import type { StageResult, StageStatus } from '../compiler/index';
import { CheckIcon, CrossIcon, DashIcon, FocusIcon, WarnIcon } from './icons';

export interface FocusState {
  focused: string | null;
  setFocused: (id: string | null) => void;
  /** The stage the walkthrough is on. */
  current: string | null;
}

export const FocusContext = createContext<FocusState>({ focused: null, setFocused: () => {}, current: null });

export const STATUS_WORD: Record<StageStatus, string> = {
  ok: 'Passed', warn: 'Passed with warnings', error: 'Failed', skipped: 'Skipped',
};

export function StatusIcon({ status }: { status: StageStatus }) {
  switch (status) {
    case 'ok': return <CheckIcon />;
    case 'warn': return <WarnIcon />;
    case 'error': return <CrossIcon />;
    case 'skipped': return <DashIcon />;
  }
}

export function formatTime(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

interface CardProps {
  stage: StageResult;
  intro: string;
  children?: ComponentChildren;
}

/** One stage of the walkthrough: heading, plain-language intro, then its content. */
export function Card({ stage, intro, children }: CardProps) {
  const { focused, setFocused, current } = useContext(FocusContext);
  const id = stage.stage;
  const isFocused = focused === id;

  useEffect(() => {
    if (!isFocused) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocused(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFocused, setFocused]);

  const classes = ['stage', `is-${stage.status}`, isFocused && 'is-focused', current === id && 'is-current'];
  return (
    <section class={classes.filter(Boolean).join(' ')} id={`card-${id}`} data-card={id}>
      <header class="stage-head">
        <h2>Stage {stage.number} · {stage.title}</h2>
        <div class="stage-actions">
          <span class={`stage-status is-${stage.status}`} data-testid={`status-${id}`}>
            <StatusIcon status={stage.status} /> {STATUS_WORD[stage.status]}
          </span>
          <button class="button" data-testid={`focus-${id}`} aria-pressed={isFocused}
            onClick={() => setFocused(isFocused ? null : id)}>
            <FocusIcon /> {isFocused ? 'Exit focus' : 'Focus'}
          </button>
        </div>
      </header>
      <p class="stage-intro">{intro}</p>
      <div class="stage-body">{children}</div>
    </section>
  );
}

/** Body of a stage that did not run. */
export function SkippedNote({ stage }: { stage: StageResult }) {
  return <p class="muted">{stage.title} did not run, because an earlier stage stopped the pipeline.</p>;
}

/** Collapsible reference material, so that the main story stays short. */
export function Reference({ title, open, children }: { title: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="reference" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

import type { StageResult } from '../compiler/index';
import type { View } from './App';
import { formatTime, STATUS_WORD } from './Card';
import { CrossIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, WarnIcon } from './icons';
import type { Walkthrough } from './useWalkthrough';

interface PipelineBarProps {
  stages: readonly StageResult[];
  walk: Walkthrough;
  view: View;
  onShow: (view: View) => void;
}

/** The house the brand sits in, drawn in the same line weight as the icons. */
function HouseMark() {
  return (
    <svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linejoin="round" aria-hidden="true">
      <path d="M3 11 12 3.5 21 11M5.5 9v11.5h13V9" />
      <path d="M10 20.5v-6h4v6" />
    </svg>
  );
}

/**
 * The rail. Each stage is a station on a wire that runs from the source to the
 * home. The wire is lit as far as the program got; a failed stage breaks it, and
 * the stages after it stay dark. Every station has a fixed shape, so recompiling
 * never moves anything.
 */
export function PipelineBar({ stages, walk, view, onShow }: PipelineBarProps) {
  return (
    <header class="topbar">
      <h1 class="brand"><HouseMark /> <span>Let's Automate<br />a Home</span></h1>
      <button class={`rail-primer ${view === 'domain' ? 'is-on' : ''}`} aria-pressed={view === 'domain'}
        aria-label="Open the primer" onClick={() => onShow(view === 'domain' ? 'lexer' : 'domain')}>
        Primer
      </button>
      <ol class="stepper" aria-label="Compiler stages" data-testid="pipeline">
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const selected = view === s.stage;
          return (
            <li key={s.stage} class="station">
              <button class={`step is-${s.status} ${walk.current === s.stage ? 'is-current' : ''} ${selected ? 'is-selected' : ''}`}
                data-stage={s.stage} data-status={s.status} aria-current={selected ? 'step' : undefined}
                aria-label={`Stage ${s.number}, ${s.title}: ${STATUS_WORD[s.status]}`}
                title={s.status === 'skipped' ? undefined : formatTime(s.timeMs)}
                onClick={() => onShow(s.stage)}>
                <span class="step-number">{s.number}</span>
                <span class="step-text">
                  <span class="step-name">
                    {s.status === 'warn' && <WarnIcon />}
                    {s.status === 'error' && <CrossIcon />}
                    {s.title}
                  </span>
                  <span class="step-meta">{s.status === 'skipped' ? 'Skipped' : s.status === 'error' ? 'Failed' : formatTime(s.timeMs)}</span>
                </span>
              </button>
              {next && <span class={`wire ${next.status === 'skipped' ? 'is-off' : 'is-lit'}`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      <div class="walk" role="group" aria-label="Walk through the stages">
        <button class="button" data-testid="walk-prev" disabled={!walk.canPrev} onClick={walk.prev} aria-label="Previous stage" title="Previous stage"><PrevIcon /></button>
        <button class="button is-primary" data-testid="walk-play" onClick={walk.togglePlay}>
          {walk.playing ? <PauseIcon /> : <PlayIcon />} {walk.playing ? 'Pause' : 'Play'}
        </button>
        <button class="button" data-testid="walk-next" disabled={!walk.canNext} onClick={walk.next} aria-label="Next stage" title="Next stage"><NextIcon /></button>
      </div>
    </header>
  );
}

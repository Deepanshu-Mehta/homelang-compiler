import type { StageResult } from '../compiler/index';
import { formatTime, STATUS_WORD, StatusIcon } from './Card';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from './icons';
import { scrollToCard } from './scroll';
import type { Walkthrough } from './useWalkthrough';

interface PipelineBarProps {
  stages: readonly StageResult[];
  walk: Walkthrough;
}

/** The sticky stepper. Each step has a fixed shape, so recompiling never moves it. */
export function PipelineBar({ stages, walk }: PipelineBarProps) {
  return (
    <header class="topbar">
      <h1 class="brand">Let's Automate a Home</h1>
      <ol class="stepper" aria-label="Compiler stages" data-testid="pipeline">
        {stages.map((s) => (
          <li key={s.stage}>
            <button class={`step is-${s.status} ${walk.current === s.stage ? 'is-current' : ''}`}
              data-stage={s.stage} data-status={s.status}
              aria-label={`Stage ${s.number}, ${s.title}: ${STATUS_WORD[s.status]}`}
              onClick={() => scrollToCard(s.stage)}>
              <span class="step-number">{s.number}</span>
              <span class="step-text">
                <span class="step-name">{s.title}</span>
                <span class="step-meta">
                  <StatusIcon status={s.status} />
                  {s.status === 'skipped' ? 'Skipped' : formatTime(s.timeMs)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div class="walk" role="group" aria-label="Walk through the stages">
        <button class="button" data-testid="walk-prev" disabled={!walk.canPrev} onClick={walk.prev}><PrevIcon /> Prev</button>
        <button class="button is-primary" data-testid="walk-play" onClick={walk.togglePlay}>
          {walk.playing ? <PauseIcon /> : <PlayIcon />} {walk.playing ? 'Pause' : 'Play'}
        </button>
        <button class="button" data-testid="walk-next" disabled={!walk.canNext} onClick={walk.next}>Next <NextIcon /></button>
      </div>
    </header>
  );
}

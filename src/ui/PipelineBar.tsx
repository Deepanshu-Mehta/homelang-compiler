import type { ComponentChildren } from 'preact';
import type { StageResult } from '../compiler/index';
import { formatTime, STATUS_WORD, StatusIcon } from './Card';
import { scrollToCard } from './scroll';

interface PipelineBarProps {
  stages: readonly StageResult[];
  current: string | null;
  children?: ComponentChildren;
}

/** The sticky stepper. Each step has a fixed shape, so recompiling never moves it. */
export function PipelineBar({ stages, current, children }: PipelineBarProps) {
  return (
    <header class="topbar">
      <h1 class="brand">Let's Automate a Home</h1>
      <ol class="stepper" aria-label="Compiler stages" data-testid="pipeline">
        {stages.map((s) => (
          <li key={s.stage}>
            <button class={`step is-${s.status} ${current === s.stage ? 'is-current' : ''}`}
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
      {children}
    </header>
  );
}

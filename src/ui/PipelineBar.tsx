import type { StageResult, StageStatus } from '../compiler/index';
import { scrollToCard } from './scroll';

const BADGE: Record<StageStatus, string> = { ok: '✓', warn: '⚠', error: '✗', skipped: '–' };

function formatTime(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export function PipelineBar({ stages }: { stages: readonly StageResult[] }) {
  return (
    <nav class="pipeline" aria-label="Compiler stages" data-testid="pipeline">
      {stages.map((s) => (
        <button
          key={s.stage}
          class={`stage-badge is-${s.status}`}
          data-stage={s.stage}
          data-status={s.status}
          onClick={() => scrollToCard(s.stage)}
        >
          <span class="stage-icon">{BADGE[s.status]}</span>
          <span class="stage-name">{s.title}</span>
          {s.status !== 'skipped' && <span class="stage-time">{formatTime(s.timeMs)}</span>}
        </button>
      ))}
    </nav>
  );
}

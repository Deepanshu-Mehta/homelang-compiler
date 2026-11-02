import type { ComponentChildren } from 'preact';
import type { StageResult } from '../compiler/index';

interface CardProps {
  id: string;
  badge: string;
  title: string;
  intro: string;
  status?: StageResult['status'];
  children?: ComponentChildren;
}

export function Card({ id, badge, title, intro, status, children }: CardProps) {
  return (
    <section class={`card ${status ? `is-${status}` : ''}`} id={`card-${id}`} data-card={id}>
      <header class="card-head">
        <span class="card-badge">{badge}</span>
        <div>
          <h2>{title}</h2>
          <p class="card-intro">{intro}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Body of a card whose stage did not run. */
export function SkippedNote({ stage }: { stage: StageResult }) {
  return <p class="muted">{stage.title} did not run, because an earlier stage stopped the pipeline.</p>;
}

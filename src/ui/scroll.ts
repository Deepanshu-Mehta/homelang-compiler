const prefersLessMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scrolls the right pane to a stage and marks it so that the eye can find it. */
export function scrollToCard(stage: string): void {
  const card = document.getElementById(`card-${stage}`);
  if (!card) return;
  card.scrollIntoView({ behavior: prefersLessMotion() ? 'auto' : 'smooth', block: 'start' });
  card.classList.remove('flash');
  void card.offsetWidth; // restart the CSS animation
  card.classList.add('flash');
}

export function scrollToTop(): void {
  document.querySelector('.right-pane')?.scrollTo({ top: 0 });
}

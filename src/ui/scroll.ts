/** Scrolls the right pane to a card and flashes it so the eye can find it. */
export function scrollToCard(stage: string): void {
  const card = document.getElementById(`card-${stage}`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.remove('flash');
  void card.offsetWidth; // restart the CSS animation
  card.classList.add('flash');
}

/** Starts the right pane from the top, because a new stage is a new page. */
export function scrollToTop(): void {
  document.querySelector('.right-pane')?.scrollTo({ top: 0 });
}

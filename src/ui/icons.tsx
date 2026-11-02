import type { ComponentChildren } from 'preact';

/** Icons are drawn here so that the page has no image or icon-font dependency. */
function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const CheckIcon = () => <Icon><path d="M3 8.5 6.5 12 13 4.5" /></Icon>;
export const CrossIcon = () => <Icon><path d="M4 4l8 8M12 4l-8 8" /></Icon>;
export const WarnIcon = () => <Icon><path d="M8 2.5 14.5 13.5h-13zM8 6.5v3.5M8 11.9v.1" /></Icon>;
export const InfoIcon = () => <Icon><circle cx="8" cy="8" r="6.2" /><path d="M8 7.5v3.5M8 5v.1" /></Icon>;
export const DashIcon = () => <Icon><path d="M4 8h8" /></Icon>;
export const PlayIcon = () => <Icon><path d="M4.5 3v10L13 8z" fill="currentColor" /></Icon>;
export const PauseIcon = () => <Icon><path d="M5.5 3v10M10.5 3v10" /></Icon>;
export const PrevIcon = () => <Icon><path d="M10.5 3 5.5 8l5 5" /></Icon>;
export const NextIcon = () => <Icon><path d="M5.5 3l5 5-5 5" /></Icon>;
export const FocusIcon = () => <Icon><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Icon>;
export const PlusIcon = () => <Icon><path d="M8 3.5v9M3.5 8h9" /></Icon>;
export const MinusIcon = () => <Icon><path d="M3.5 8h9" /></Icon>;

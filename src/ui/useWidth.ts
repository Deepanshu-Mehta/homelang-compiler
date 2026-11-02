import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * The element's width in CSS pixels. Diagrams draw to this width instead of
 * scaling a fixed drawing, so their text stays at its true size.
 */
export function useWidth<T extends Element>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(element.getBoundingClientRect().width || initial);
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
    // The initial width is only a fallback for the first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [ref, width] as const;
}

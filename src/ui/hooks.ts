import { useEffect, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/** Phone-sized screens. */
export const NARROW = '(max-width: 720px)';

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const update = () => setOn(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return on;
}

/**
 * Calls close() on Escape or on a pointer press outside the element.
 * `except` is the button that opens the popover, as a ref or a CSS selector:
 * a press on it is left to the button's own click, which closes the popover.
 * Otherwise the press would close it and the click would open it again.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, close: () => void, except?: RefObject<HTMLElement | null> | string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (typeof except === 'string' ? (target as Element).closest?.(except) : except?.current?.contains(target)) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [ref, close, except]);
}

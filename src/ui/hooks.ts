import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { Component, createElement, type FunctionComponent, type RefObject } from 'preact';

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
 * The Escape that closes it is marked as used (its default prevented), so
 * what Escape does otherwise, such as ending select mode, waits for the next.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, close: () => void, except?: RefObject<HTMLElement | null> | string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
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

/**
 * Where the keyboard focus goes after an action that takes away the focused
 * element (Remove, Combine, Back): found once the next render is done, by a
 * component that calls useFocusAfterRender(), so the element is there by then.
 */
let focusNext: (() => HTMLElement | null | undefined) | null = null;

export function focusAfterRender(find: () => HTMLElement | null | undefined) {
  focusNext = find;
}

/** A track row's main button (its name): where the keyboard goes back to after an action on the list. */
export const rowButton = (id: string) => document.querySelector<HTMLElement>(`.track-row[data-track="${id}"] .track-main`);

/** The list's Add button, or with no track left, the start screen's Open button. */
export const openButton = () => document.getElementById('tlp-add') ?? document.querySelector<HTMLElement>('.empty-actions button');

/** Moves the focus asked for by focusAfterRender() once this component has rendered. */
export function useFocusAfterRender() {
  useLayoutEffect(() => {
    const find = focusNext;
    if (!find) return;
    focusNext = null;
    find()?.focus();
  });
}

/**
 * A component that renders again only when one of its props changes (or a
 * signal it reads does), not whenever its parent does: preact/compat's memo,
 * without loading the rest of compat (which hooks into every element the app renders).
 */
export function memo<P extends object>(view: FunctionComponent<P>): FunctionComponent<P> {
  return class Memo extends Component<P> {
    shouldComponentUpdate(next: P) {
      const now = this.props as Record<string, unknown>, then = next as Record<string, unknown>;
      for (const k in then) if (now[k] !== then[k]) return true;
      for (const k in now) if (!(k in then)) return true;
      return false;
    }
    render(props: P) { return createElement(view, props); }
  } as unknown as FunctionComponent<P>;
}

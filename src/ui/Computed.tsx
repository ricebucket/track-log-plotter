// Marks values the app works out itself (they aren't in the file), with an
// explanation shown on hover, keyboard focus or tap.
import { useRef } from 'preact/hooks';
import { signal } from '@preact/signals';
import { t } from '../state/store';
import { IconCalc } from './icons';

export interface Hint { id: number; text: string; x: number; y: number; bottom: number; pinned: boolean; title?: string }
export const hint = signal<Hint | null>(null);
let nextId = 1;

/** A stable id for an element that shows hints. */
export function useHintId(): number {
  return useRef(nextId++).current;
}

/** Hover and focus handlers that show a hint (with its own title) for any element, such as a link. */
export function hintHandlers(id: number, text: string, title: string) {
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    hint.value = { id, text, title, x: r.left + r.width / 2, y: r.top, bottom: r.bottom, pinned: false };
  };
  const hide = () => { if (hint.value?.id === id) hint.value = null; };
  return {
    onMouseEnter: (e: MouseEvent) => show(e.currentTarget as HTMLElement),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent) => show(e.currentTarget as HTMLElement),
    onBlur: hide,
  };
}

/** A small calculator button beside a computed value. */
export function Computed({ text }: { text: string }) {
  const id = useRef(nextId++).current;
  const show = (el: HTMLElement, pinned: boolean) => {
    const r = el.getBoundingClientRect();
    hint.value = { id, text, x: r.left + r.width / 2, y: r.top, bottom: r.bottom, pinned };
  };
  const hide = () => { if (hint.value?.id === id && !hint.value.pinned) hint.value = null; };
  return (
    <button
      type="button" class="computed-btn" aria-label={`${t('computed.label')}: ${text}`}
      onMouseEnter={(e) => show(e.currentTarget as HTMLElement, false)}
      onMouseLeave={hide}
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={(e) => show(e.currentTarget as HTMLElement, false)}
      onBlur={() => { if (hint.value?.id === id) hint.value = null; }}
      onClick={(e) => {
        e.stopPropagation();
        if (hint.value?.id === id && hint.value.pinned) hint.value = null;
        else show(e.currentTarget as HTMLElement, true);
      }}
    >
      <IconCalc />
    </button>
  );
}

/** The same mark where nothing can be clicked (the map inspector). */
export function ComputedMark() {
  return <span class="computed-mark" aria-hidden="true"><IconCalc size={11} /></span>;
}

/** Shows the explanation of the hovered or focused calculator button. */
export function HintLayer() {
  const h = hint.value;
  if (!h) return null;
  const W = 260;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const left = Math.max(8, Math.min(vw - W - 8, h.x - W / 2));
  const above = h.y > 140;
  return (
    <div
      class="hint" role="tooltip"
      style={{ left: `${left}px`, width: `${W}px`, ...(above ? { bottom: `${(typeof window === 'undefined' ? 900 : window.innerHeight) - h.y + 8}px` } : { top: `${h.bottom + 8}px` }) }}
    >
      <span class="hint-title">{h.title ?? t('computed.label')}</span>
      {h.text}
    </div>
  );
}

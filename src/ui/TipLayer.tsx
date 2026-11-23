// Hover text that shows quickly. Browsers wait about a second before showing an
// element's title, and a page can't change that. So on mouse hover the title
// moves to data-tip (the browser then has nothing to show) and the app shows it
// in its own bubble after a short pause; moving on to the next element while a
// bubble is up shows the next one at once. Touch and keyboard use the labels,
// which keep the text.
import { useEffect } from 'preact/hooks';
import { signal } from '@preact/signals';

/** How long the pointer rests on an element before its hover text shows (ms). */
export const TIP_DELAY_MS = 300;
/** A bubble shown within this long (ms) of the last one shows without the pause. */
const WARM_MS = 800;

interface Tip { text: string; x: number; top: number; bottom: number }
export const tip = signal<Tip | null>(null);

const TIPPED = '[title], [data-tip]';

/**
 * Moves an element's title into data-tip, keeping it for assistive tech: as its
 * label when it has no other, else as its description.
 */
export function takeTitle(el: Element) {
  const title = el.getAttribute('title');
  if (title === null) return;
  el.removeAttribute('title');
  el.setAttribute('data-tip', title);
  if (!title) return;
  const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || (el.textContent ?? '').trim() !== '';
  if (!named) el.setAttribute('aria-label', title);
  else if (!el.hasAttribute('aria-describedby') && el.getAttribute('aria-label') !== title) el.setAttribute('aria-description', title);
}

export function TipLayer() {
  useEffect(() => {
    let timer = 0, hovered: Element | null = null, lastShown = -Infinity;
    const hide = () => {
      clearTimeout(timer);
      if (tip.peek()) lastShown = performance.now();
      tip.value = null;
    };
    const show = () => {
      const el = hovered?.closest?.(TIPPED);
      if (!el || !el.isConnected) return;
      takeTitle(el);
      const text = el.getAttribute('data-tip');
      if (!text) return;
      const r = el.getBoundingClientRect();
      tip.value = { text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const target = e.target as Element;
      if (target === hovered) return;
      const was = hovered?.closest?.(TIPPED) ?? null;
      hovered = target;
      // Taken now, before the browser's own timer runs out.
      const el = target.closest?.(TIPPED);
      if (el) takeTitle(el);
      if (el && el === was && tip.peek()) return; // still over the same element
      hide();
      const warm = performance.now() - lastShown < WARM_MS;
      timer = window.setTimeout(show, warm ? 0 : TIP_DELAY_MS);
    };
    const out = (e: PointerEvent) => {
      const to = e.relatedTarget as Element | null;
      if (to && hovered && (to === hovered || hovered.contains(to))) return;
      if (!to) { hovered = null; hide(); }
    };
    const away = () => { hovered = null; hide(); };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', away, true);
    document.addEventListener('wheel', away, { capture: true, passive: true });
    window.addEventListener('blur', away);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', away, true);
      document.removeEventListener('wheel', away, { capture: true });
      window.removeEventListener('blur', away);
      tip.value = null;
    };
  }, []);

  const t = tip.value;
  if (!t) return null;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  // Below the element, or above it near the bottom of the window; never off the sides.
  const W = Math.min(320, vw - 16);
  const left = Math.max(8, Math.min(vw - W - 8, t.x - W / 2));
  const below = t.bottom + 64 < vh;
  return (
    <div class="tip-bubble-wrap" style={{ left: `${left}px`, width: `${W}px`, ...(below ? { top: `${t.bottom + 6}px` } : { bottom: `${vh - t.top + 6}px` }) }} aria-hidden="true">
      <div class="tip-bubble">{t.text}</div>
    </div>
  );
}

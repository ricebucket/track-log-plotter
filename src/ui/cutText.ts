/**
 * Hover text for text that may be cut off with an ellipsis: on pointer entry,
 * the element gets the full text as its hover text (shown by TipLayer, after a
 * short pause), but only while some of it is hidden. `clip` finds the element
 * that cuts the text off (by default, the element itself).
 */
export function fullTextIfCut(full: string, clip?: (el: HTMLElement) => HTMLElement | null) {
  return (e: { currentTarget: EventTarget | null }) => {
    const el = e.currentTarget as HTMLElement | null;
    if (!el) return;
    const box = clip ? clip(el) : el;
    if (box && box.scrollWidth > box.clientWidth) el.setAttribute('data-tip', full);
    else el.removeAttribute('data-tip');
  };
}

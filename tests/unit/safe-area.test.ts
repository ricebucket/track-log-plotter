// Phones with a notch. The page runs under the notch, the rounded corners and the
// home indicator (viewport-fit=cover), so the controls keep clear of them: each
// edge they keep is what it was, or the safe-area inset where that is more (the
// insets are 0 on a computer and on a phone without a notch, so nothing moves
// there). A browser test can't give the page insets, so this reads the style sheet.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
/** A media query's block. */
const block = (query: string) => css.match(new RegExp(`\\n@media ${query.replace(/[()]/g, '\\$&')} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
const phone = block('(max-width: 720px)');
const mid = block('(min-width: 721px) and (max-width: 1180px)');
/** The declarations of the rule for exactly `selector`: top level, or with `indent` inside a media block. */
function rule(sheet: string, selector: string, indent = ''): string {
  const text = `\n${sheet}`;
  const at = text.indexOf(`\n${indent}${selector} {`);
  return at < 0 ? '' : text.slice(text.indexOf('{', at) + 1, text.indexOf('}', at));
}
const top = (selector: string) => rule(css, selector);
const onPhone = (selector: string) => rule(phone, selector, '  ');

describe('the safe areas of a phone with a notch', () => {
  it('keeps the controls 16px in on a computer, or clear of the notch, the corners and the home indicator, the map edge to edge under them', () => {
    // The page runs under the notch, and so does the map.
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
    const map = top('.map, .map.maplibregl-map');
    expect(map).toContain('inset: 0');
    expect(map).not.toContain('env(');
    const root = top(':root');
    expect(root).toContain('--edge-l: max(16px, env(safe-area-inset-left));');
    expect(root).toContain('--edge-r: max(16px, env(safe-area-inset-right));');
    expect(root).toContain('--edge-b: max(16px, env(safe-area-inset-bottom));');
    // Everything placed beside the panel moves with it.
    expect(root).toContain('--pane-left: calc(var(--edge-l) + var(--panel-w) + 16px);');
    expect(top('.app.panel-min')).toContain('--pane-left: var(--edge-l)');
    // The panel and the timeline, at the left and right edges in landscape, and above the home indicator.
    expect(top('.panel')).toMatch(/left: var\(--edge-l\);.*bottom: var\(--edge-b\);/);
    expect(top('.timeline')).toMatch(/right: var\(--edge-r\); bottom: var\(--edge-b\);/);
    expect(top('.panel-pill')).toContain('left: var(--edge-l)');
    expect(top('.timeline-pill')).toContain('bottom: var(--edge-b)');
    expect(top('.map-tools')).toContain('right: var(--edge-r)');
    expect(top('.map-footer')).toContain('right: var(--edge-r); bottom: calc(var(--edge-b) + var(--tl-h) + 10px)');
    expect(top('.brand-pill')).toContain('left: var(--edge-l)');
  });

  it('keeps the notices clear of the notch, wherever they stand', () => {
    // Beside the map buttons: as far from the right edge as the buttons, which move in with it.
    expect(top('.map-notices, .toasts')).toContain('right: calc(var(--edge-r) + 284px)');
    // Below the buttons, across the map: the notices themselves keep clear of the right edge.
    expect(rule(mid, '.app:not(.panel-min) .map-notices, .app:not(.panel-min) .toasts', '  ')).toContain('padding-right: calc(var(--edge-r) - 16px)');
    expect(onPhone('.map-notices, .toasts')).toContain('left: var(--edge-l); right: var(--edge-r);');
  });

  it("keeps a phone's bottom sheets and the buttons near the bottom above the home indicator", () => {
    expect(onPhone(':root')).toContain('--edge-l: max(8px, env(safe-area-inset-left)); --edge-r: max(8px, env(safe-area-inset-right)); --edge-b: max(8px, env(safe-area-inset-bottom));');
    // The sheet itself still runs to the bottom edge.
    expect(onPhone('.panel')).toContain('bottom: 0;');
    expect(onPhone('.panel')).toContain('padding-bottom: env(safe-area-inset-bottom)');
    expect(onPhone('.sheet-foot')).toContain('padding-bottom: calc(12px + env(safe-area-inset-bottom))');
    expect(onPhone('.zone-picker')).toContain('padding-bottom: calc(14px + env(safe-area-inset-bottom))');
    expect(onPhone('.panel-pill')).toContain('bottom: var(--edge-b)');
    expect(onPhone('.timeline-pill')).toContain('bottom: var(--edge-b)');
    expect(onPhone('.panel-min .timeline')).toContain('bottom: var(--edge-b)');
    // No control is left 8px from an edge regardless of the insets.
    expect(phone).not.toMatch(/\b(left|right|bottom): 8px/);
  });
});

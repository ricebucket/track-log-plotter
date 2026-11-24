// Every class the interface gives an element has a style, or is on the short list of classes that only
// mark something for code or tests. A commit once dropped the rules of a class still in use, and the
// time zone button was left looking like a plain browser button.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/fixtures';

/** Classes that mark an element for code, tests or a parent's rule, and need no style of their own. */
const MARKS = new Set([
  'is-selected', 'is-hidden', 'is-ticked', 'is-open', 'is-on', 'is-off', 'is-out', 'is-asking', 'is-editing', 'is-tight', 'is-tightest',
  'can-rename', 'danger', 'small', 'big', 'tiny', 'mono', 'muted', 'grow',
]);

describe('the stylesheet', () => {
  it('styles every class the interface uses in a plain class="…" (marks aside)', () => {
    const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
    const styled = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]));
    const dir = join(ROOT, 'src', 'ui');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      for (const value of classValues(readFileSync(join(dir, f), 'utf8'))) {
        // The words of every string in it (a template's fixed parts): class="a b", class={`a${x ? ' b' : ''}`}.
        for (const lit of value.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)) {
          for (const w of (lit[1] ?? lit[2] ?? lit[3]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(w)) used.add(w);
        }
      }
    }
    const unstyled = [...used].filter((c) => !styled.has(c) && !MARKS.has(c)).sort();
    expect(unstyled).toEqual([]);
  });
});

/** Each class attribute's value as written: a "…" string, or a {…} expression with its braces balanced. */
function classValues(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bclass=/g)) {
    const at = m.index! + m[0].length;
    if (src[at] === '"') { out.push(src.slice(at, src.indexOf('"', at + 1) + 1)); continue; }
    if (src[at] !== '{') continue;
    let depth = 0, k = at;
    for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; }
    out.push(src.slice(at + 1, k));
  }
  return out;
}

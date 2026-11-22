import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { initialLang, MESSAGES, placeholders, translate } from '../../src/i18n/i18n';
import { ROOT } from '../helpers/fixtures';

const en = MESSAGES.en, zh = MESSAGES.zh;

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe('translations', () => {
  it('has every key in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses the same placeholders in both languages', () => {
    for (const k of Object.keys(en)) expect(placeholders(zh[k]), k).toEqual(placeholders(en[k]));
  });

  it('picks plural forms', () => {
    expect(translate('en', 'track.problems', { n: 1 })).toBe('1 problem');
    expect(translate('en', 'track.problems', { n: 3 })).toBe('3 problems');
    expect(translate('zh', 'track.problems', { n: 3 })).toBe('3 个问题');
  });

  it('falls back to English, then to the key', () => {
    expect(translate('zh', 'no.such.key')).toBe('no.such.key');
  });

  it('chooses the first language from the address, the saved choice, then the browser', () => {
    expect(initialLang('?lang=zh-CN', 'en', ['en-US'])).toBe('zh');
    expect(initialLang('', 'zh', ['en-US'])).toBe('zh');
    expect(initialLang('', null, ['zh-TW', 'en'])).toBe('zh');
    expect(initialLang('', null, ['fr-FR', 'en-GB'])).toBe('en');
    expect(initialLang('', null, ['fr-FR'])).toBe('en');
  });

  it('every key used in the code exists, and every message is used', () => {
    const src = files(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const used = new Set([...src.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]));
    for (const k of used) expect(en[k], `missing message ${k}`).toBeDefined();
    // Keys built at run time: `measure.${k}`, `basemap.${id}`, `problem.${kind}.title`…
    const dynamic = /^(measure|basemap|problem|note|unit|field|halo\.hint|toast\.error|settings|fix)\./;
    for (const k of Object.keys(en)) {
      if (dynamic.test(k)) continue;
      expect(used.has(k), `unused message ${k}`).toBe(true);
    }
  });

  it('keeps interface text out of the components', () => {
    // Text between tags in JSX must come from the message files. Allowed: the
    // format names, the language names and symbols.
    const allowed = new Set(['GPX', 'NMEA', 'EN', '中文', 'UTC', 'HDOP', 'VDOP', 'PDOP', '#', '×', '✓', '–', '9']);
    const bad: string[] = [];
    let scanned = 0;
    for (const f of files(join(ROOT, 'src', 'ui'))) {
      if (!f.endsWith('.tsx')) continue;
      const text = readFileSync(f, 'utf8');
      scanned++;
      // The lookbehind skips the ">" of arrow functions (=>).
      for (const m of text.matchAll(/(?<![-=])>\s*([^<>{}\n]*[A-Za-z一-鿿][^<>{}\n]*?)\s*</g)) {
        const s = m[1].trim();
        if (!s || allowed.has(s) || /^[)\],;:=&|?!.\s]/.test(s) || /=>|&&|\|\||\?\s|\bconst\b|\breturn\b/.test(s)) continue;
        bad.push(`${f}: "${s}"`);
      }
    }
    expect(scanned).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});

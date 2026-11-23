import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeEntities, localName, scanXml } from '../../src/parse/xml';

function events(src: string) {
  const out: string[] = [];
  const r = scanXml(src, {
    open: (n, a, line) => out.push(`<${n}${[...a].map(([k, v]) => ` ${k}=${v}`).join('')}@${line}`),
    close: (n) => out.push(`</${n}`),
    text: (t) => out.push(`"${t}"`),
  });
  return { out, r };
}

describe('scanXml', () => {
  it('hands out the right name for every tag, however many names share a slot of its name cache', () => {
    // 700 different names, short and long, prefixed, with and without
    // attributes, ASCII and not: far more than the cache has slots.
    const names = Array.from({ length: 700 }, (_, i) => {
      const base = `n${i.toString(36)}`;
      if (i % 7 === 0) return `ns${i % 3}:${base}`;
      if (i % 5 === 0) return base + 'x'.repeat(i % 20);
      return i % 11 === 0 ? `${base}\u00e9` : base;
    });
    const parts = ['<root>'], want = ['<root@1'];
    for (let k = 0; k < 6000; k++) {
      const nm = names[(k * 7919) % names.length], local = localName(nm);
      if (k % 13 === 0) { parts.push(`<${nm} a="${k}">${k}</${nm} >`); want.push(`<${local} a=${k}@1`, `"${k}"`, `</${local}`); }
      else if (k % 17 === 0) { parts.push(`<${nm}/>`); want.push(`<${local}@1`, `</${local}`); }
      else { parts.push(`<${nm}>${k}</${nm}>`); want.push(`<${local}@1`, `"${k}"`, `</${local}`); }
    }
    parts.push('</root>');
    want.push('</root');
    expect(events(parts.join('')).out).toEqual(want);
  });

  it('reports tags, attributes, text and line numbers', () => {
    const { out, r } = events('<?xml version="1.0"?>\n<a x="1" y=\'two\'>\n  <b>hi &amp; bye</b>\n  <c/>\n</a>');
    expect(out).toEqual(['<a x=1 y=two@2', '<b@3', '"hi & bye"', '</b', '<c@4', '</c', '</a']);
    expect(r).toEqual({ complete: true, wellFormed: true, line: 5 });
  });

  it('strips namespace prefixes', () => {
    expect(events('<gpxtpx:speed>3</gpxtpx:speed>').out).toEqual(['<speed@1', '"3"', '</speed']);
  });

  it('skips comments and reads CDATA', () => {
    expect(events('<a><!-- <b> --><![CDATA[x < y]]></a>').out).toEqual(['<a@1', '"x < y"', '</a']);
  });

  it('keeps a ">" inside a quoted attribute', () => {
    expect(events('<a t="1 > 0"/>').out).toEqual(['<a t=1 > 0@1', '</a']);
  });

  it('stops cleanly in a tag that was cut off', () => {
    const { out, r } = events('<a><b>1</b><c x="4');
    expect(out).toEqual(['<a@1', '<b@1', '"1"', '</b']);
    expect(r.complete).toBe(false);
  });

  it('reports a tag that runs into another tag', () => {
    const { r } = events('<a><b x="1" <c>');
    expect(r.wellFormed).toBe(false);
  });

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('&lt;&#65;&#x42;&quot;&apos;&gt;')).toBe('<AB"\'>');
    expect(localName('a:b')).toBe('b');
  });

  it('never throws on arbitrary input', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const r = scanXml(s, { open() {}, close() {}, text() {} });
      expect(typeof r.complete).toBe('boolean');
    }));
  });

  it('round-trips escaped text', () => {
    fc.assert(fc.property(fc.string(), (s) => {
      const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let got = '';
      scanXml(`<a>${esc}</a>`, { open() {}, close() {}, text(t) { got += t; } });
      expect(got).toBe(s.trim() ? s : '');
    }));
  });
});

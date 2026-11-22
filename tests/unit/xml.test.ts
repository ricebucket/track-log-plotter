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

// A small, forgiving XML scanner for GPX. It streams over the text without
// building a document, strips namespace prefixes, and stops cleanly where a
// damaged file ends, so the parser keeps everything read before that point.
//
// If GPX files start tripping this scanner in several complicated ways
// (DOCTYPE internal subsets, unusual encodings, odd markup), switch to a widely
// used streaming XML library such as saxes instead of patching this further.
// gpx.ts only uses the open/close/text callbacks below, so the swap stays local
// to this file. Keep the tests in tests/unit/xml.test.ts and gpx.test.ts as the
// check that the replacement still keeps everything before a cut-off point.

export interface XmlSink {
  open(name: string, attrs: Map<string, string>, line: number): void;
  close(name: string): void;
  text(text: string): void;
}

export interface XmlScanResult {
  /** False when the text ended inside a tag, comment or CDATA section. */
  complete: boolean;
  /** False when a tag could not be read at all. */
  wellFormed: boolean;
  /** Line of the problem, or the last line. */
  line: number;
}

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY, (_m, e: string) => {
    if (e[0] !== '#') return NAMED[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** Local part of a possibly prefixed name ("gpxtpx:speed" → "speed"). */
export function localName(name: string): string {
  const c = name.indexOf(':');
  return c < 0 ? name : name.slice(c + 1);
}

const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** Shared by every tag without attributes; never modified. */
const NO_ATTRS: Map<string, string> = new Map();

function parseAttrs(s: string): Map<string, string> {
  if (s.indexOf('=') < 0) return NO_ATTRS;
  const m = new Map<string, string>();
  ATTR.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = ATTR.exec(s))) m.set(localName(a[1]), decodeEntities(a[2] ?? a[3] ?? ''));
  return m;
}

/** Index of the ">" that ends the tag starting at i, skipping quoted values; -1 if none. */
function tagEnd(src: string, i: number): number {
  let q = 0;
  for (let k = i; k < src.length; k++) {
    const c = src.charCodeAt(k);
    if (q) { if (c === q) q = 0; continue; }
    if (c === 34 || c === 39) q = c;
    else if (c === 62) return k;
    else if (c === 60) return -2; // "<" inside a tag: the tag was cut off
  }
  return -1;
}

const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

export function scanXml(src: string, sink: XmlSink): XmlScanResult {
  const n = src.length;
  let i = 0;
  // Line numbers are counted lazily by jumping from newline to newline, so
  // the text is never walked character by character just to count lines.
  let line = 1;
  let nl = src.indexOf('\n');
  const lineAt = (pos: number) => {
    while (nl !== -1 && nl < pos) { line++; nl = src.indexOf('\n', nl + 1); }
    return line;
  };
  /** Passes text between tags to the sink unless it is only whitespace. */
  const text = (a: number, b: number) => {
    for (let k = a; k < b; k++) {
      if (!isSpace(src.charCodeAt(k))) { sink.text(decodeEntities(src.slice(a, b))); return; }
    }
  };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(i, n); break; }
    if (lt > i) text(i, lt);
    i = lt;
    const c1 = src.charCodeAt(i + 1);
    if (c1 === 33 /* ! */ || c1 === 63 /* ? */) {
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4);
        if (e < 0) return { complete: false, wellFormed: true, line: lineAt(i) };
        i = e + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const e = src.indexOf(']]>', i + 9);
        if (e < 0) return { complete: false, wellFormed: true, line: lineAt(i) };
        sink.text(src.slice(i + 9, e));
        i = e + 3;
        continue;
      }
      const e = src.indexOf('>', i + 2);
      if (e < 0) return { complete: false, wellFormed: true, line: lineAt(i) };
      i = e + 1;
      continue;
    }
    const gt = tagEnd(src, i + 1);
    if (gt === -1) return { complete: false, wellFormed: true, line: lineAt(i) };
    if (gt === -2) return { complete: true, wellFormed: false, line: lineAt(i) };
    if (c1 === 47 /* / */) {
      let a = i + 2, b = gt;
      while (a < b && isSpace(src.charCodeAt(a))) a++;
      while (b > a && isSpace(src.charCodeAt(b - 1))) b--;
      sink.close(localName(src.slice(a, b)));
      i = gt + 1;
      continue;
    }
    const tagLine = lineAt(i);
    const selfClose = src.charCodeAt(gt - 1) === 47;
    const end = selfClose ? gt - 1 : gt;
    let a = i + 1;
    while (a < end && isSpace(src.charCodeAt(a))) a++;
    let b = a;
    while (b < end) {
      const c = src.charCodeAt(b);
      if (isSpace(c) || c === 47) break;
      b++;
    }
    if (b === a) return { complete: true, wellFormed: false, line: tagLine };
    const name = localName(src.slice(a, b));
    sink.open(name, b < end ? parseAttrs(src.slice(b, end)) : NO_ATTRS, tagLine);
    if (selfClose) sink.close(name);
    i = gt + 1;
  }
  return { complete: true, wellFormed: true, line: lineAt(n) };
}

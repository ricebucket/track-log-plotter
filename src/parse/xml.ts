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

// A name starts the text or follows a space or a quote: a match can't start
// inside a run of name characters, so a long run without a value (<trkpt
// aaa…a=x>) is passed over once rather than tried again from each character.
const ATTR = /(?<![^\s"'])([^\s=/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
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

/**
 * Whether a character after "<" can start markup: a name (a letter, "_", ":"
 * or any character past ASCII), "/", "!" or "?". After any other ("Pace <5
 * min/km") the "<" is text.
 */
const startsMarkup = (c: number) =>
  ((c | 32) >= 97 && (c | 32) <= 122) || c === 95 || c === 58 || c === 47 || c === 33 || c === 63 || c > 127;

/** Slots in the cache of tag names (a power of two). */
const NAME_SLOTS = 256;

export function scanXml(src: string, sink: XmlSink): XmlScanResult {
  const n = src.length;
  let i = 0;
  // A file repeats a handful of tag names thousands of times. Each is cut out
  // of the text once and then handed out again as the same string, whose hash
  // the sink's lookups have already worked out.
  const rawNames: string[] = Array.from({ length: NAME_SLOTS }, () => '');
  const localNames: string[] = Array.from({ length: NAME_SLOTS }, () => '');
  // A name of up to 14 ASCII characters is its own key: seven characters to a
  // number, 7 bits each, the first number also holding the length (53 bits at
  // most, so exact). A hit then needs no check against the text.
  const key1 = new Float64Array(NAME_SLOTS).fill(-1), key2 = new Float64Array(NAME_SLOTS);
  const keyNames: string[] = Array.from({ length: NAME_SLOTS }, () => '');
  /** The local name of the tag name src[a, b). */
  const nameAt = (a: number, b: number): string => {
    const len = b - a;
    if (len <= 14) {
      let k1 = 0, k2 = 0, c = 0, k = a;
      const m = a + (len < 7 ? len : 7);
      for (; k < m; k++) { c = src.charCodeAt(k); if (c > 127) break; k1 = k1 * 128 + c; }
      if (k === m) for (; k < b; k++) { c = src.charCodeAt(k); if (c > 127) break; k2 = k2 * 128 + c; }
      if (k === b) {
        k1 = k1 * 16 + len;
        const h = (Math.imul((k1 | 0) ^ ((k1 / 4294967296) | 0), 0x9e3779b1) ^ (k2 | 0)) >>> 24;
        if (key1[h] === k1 && key2[h] === k2) return keyNames[h];
        key1[h] = k1; key2[h] = k2;
        return (keyNames[h] = localName(src.slice(a, b)));
      }
    }
    // Longer names (or not ASCII): looked up by length and end characters, then checked.
    const h = (len * 31 + src.charCodeAt(a) * 7 + src.charCodeAt(b - 1) * 3) & (NAME_SLOTS - 1);
    const raw = rawNames[h];
    if (raw.length === len && src.startsWith(raw, a)) return localNames[h];
    const r = src.slice(a, b);
    rawNames[h] = r;
    return (localNames[h] = localName(r));
  };
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
    if (i + 1 < n && !startsMarkup(c1)) { sink.text('<'); i++; continue; }
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
    // The usual tag, <name> or </name>: the name runs straight to the ">", and
    // the tag is read in one pass. Anything else takes the general way below.
    {
      const a0 = c1 === 47 ? i + 2 : i + 1;
      let k = a0;
      for (; k < n; k++) {
        const c = src.charCodeAt(k);
        if (c <= 32 || c === 62 || c === 60 || c === 34 || c === 39 || c === 47) break;
      }
      if (k > a0 && k < n && src.charCodeAt(k) === 62) {
        if (c1 === 47) sink.close(nameAt(a0, k));
        else sink.open(nameAt(a0, k), NO_ATTRS, lineAt(i));
        i = k + 1;
        continue;
      }
    }
    const gt = tagEnd(src, i + 1);
    if (gt === -1) return { complete: false, wellFormed: true, line: lineAt(i) };
    if (gt === -2) return { complete: true, wellFormed: false, line: lineAt(i) };
    if (c1 === 47 /* / */) {
      let a = i + 2, b = gt;
      while (a < b && isSpace(src.charCodeAt(a))) a++;
      while (b > a && isSpace(src.charCodeAt(b - 1))) b--;
      sink.close(b > a ? nameAt(a, b) : '');
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
    const name = nameAt(a, b);
    sink.open(name, b < end ? parseAttrs(src.slice(b, end)) : NO_ATTRS, tagLine);
    if (selfClose) sink.close(name);
    i = gt + 1;
  }
  return { complete: true, wellFormed: true, line: lineAt(n) };
}

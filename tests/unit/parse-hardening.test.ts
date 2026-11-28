// Reading files that are odd or hostile without losing them, hanging or
// freezing: the reading workers, the XML scanner and NMEA line breaks. All
// positions are synthetic, in New York City.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanXml } from '../../src/parse/xml';
import { parseGpx } from '../../src/parse/gpx';
import { nmeaChecksum, parseNmea } from '../../src/parse/nmea';
import { parseText } from '../../src/parse/index';
import type { ParseResult } from '../../src/model/types';

const gpxDoc = (body: string) => `<?xml version="1.0"?><gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1"><trk>${body}</trk></gpx>`;
const trkpt = (i: number) => `<trkpt lat="${(40.78 + i * 0.0001).toFixed(4)}" lon="-73.965"><time>2026-06-14T13:05:0${i}Z</time></trkpt>`;

/** A stand-in for the browser's Worker: it records what it's sent, and a test fires its events. */
class StubWorker {
  static made: StubWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  private handlers = new Map<string, ((e: unknown) => void)[]>();
  constructor() { StubWorker.made.push(this); }
  addEventListener(type: string, fn: (e: unknown) => void) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]); }
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  fire(type: string, e: unknown = {}) { for (const fn of this.handlers.get(type) ?? []) fn(e); }
}

/** What a promise settles to once the work already queued has run, or 'pending'. */
const settled = <T>(p: Promise<T>) => Promise.race([p, new Promise<'pending'>((r) => setTimeout(() => r('pending'), 20))]);

describe('the reading workers', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('count the files of a worker that fails as unreadable, and read the next file in a fresh worker', async () => {
    StubWorker.made = [];
    vi.stubGlobal('Worker', StubWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 }); // a pool of one worker
    vi.resetModules();
    const { parseFile } = await import('../../src/parse/client');

    // The worker answers as usual.
    const first = parseFile(new File(['x'], 'first.gpx'));
    const w1 = StubWorker.made[0];
    const answer: ParseResult = { ok: false, file: 'first.gpx', error: 'empty' };
    w1.fire('message', { data: { id: (w1.posted[0] as { id: number }).id, res: answer } });
    expect(await settled(first)).toEqual(answer);

    // It crashes with two files on it: both end, as unreadable, and it is gone.
    const a = parseFile(new File(['x'], 'a.gpx')), b = parseFile(new File(['y'], 'b.nmea'));
    expect(StubWorker.made).toHaveLength(1);
    w1.fire('error');
    expect(await settled(a)).toEqual({ ok: false, file: 'a.gpx', error: 'unreadable' });
    expect(await settled(b)).toEqual({ ok: false, file: 'b.nmea', error: 'unreadable' });
    expect(w1.terminated).toBe(true);

    // The next file goes to a new worker; one whose message can't be read goes the same way.
    const c = parseFile(new File(['z'], 'c.csv'));
    expect(StubWorker.made).toHaveLength(2);
    const w2 = StubWorker.made[1];
    expect(w2.posted.map((m) => (m as { file: File }).file.name)).toEqual(['c.csv']);
    w2.fire('messageerror');
    expect(await settled(c)).toEqual({ ok: false, file: 'c.csv', error: 'unreadable' });
    expect(w2.terminated).toBe(true);
    parseFile(new File(['w'], 'd.gpx'));
    expect(StubWorker.made).toHaveLength(3);
  });

  it('answer "unreadable" when a result can\'t be sent back', async () => {
    const listeners: ((e: { data: unknown }) => Promise<void>)[] = [];
    const posted: [unknown, unknown[]][] = [];
    vi.stubGlobal('self', {
      addEventListener: (_type: string, fn: (e: { data: unknown }) => Promise<void>) => listeners.push(fn),
      // As the browser does when something in the message can't be copied.
      postMessage(m: unknown, transfer: unknown[]) {
        if (transfer.length) throw new DOMException('could not be cloned', 'DataCloneError');
        posted.push([m, transfer]);
      },
    });
    vi.resetModules();
    await import('../../src/parse/worker');
    expect(listeners).toHaveLength(1);
    await listeners[0]({ data: { id: 7, file: new File([gpxDoc(`<trkseg>${trkpt(0)}${trkpt(1)}</trkseg>`)], 'walk.gpx') } });
    expect(posted).toEqual([[{ id: 7, res: { ok: false, file: 'walk.gpx', error: 'unreadable' } }, []]]);
  });

  it('read a file saved as UTF-16, either byte order, as the text it holds', async () => {
    const listeners: ((e: { data: unknown }) => Promise<void>)[] = [];
    const posted: { id: number; res: ParseResult }[] = [];
    vi.stubGlobal('self', {
      addEventListener: (_type: string, fn: (e: { data: unknown }) => Promise<void>) => listeners.push(fn),
      postMessage: (m: { id: number; res: ParseResult }) => posted.push(m),
    });
    vi.resetModules();
    await import('../../src/parse/worker');
    const gpx = gpxDoc(`<trkseg>${trkpt(0)}${trkpt(1)}${trkpt(2)}</trkseg>`);
    await listeners[0]({ data: { id: 1, file: utf16(gpx, 'walk.gpx') } });
    await listeners[0]({ data: { id: 2, file: utf16(NMEA_TEXT, 'walk.nmea', true) } });
    expect(posted.map((m) => (m.res.ok ? m.res.track.cols.n : m.res.error))).toEqual([3, 6]);
    expect(posted.map((m) => m.res.ok && m.res.track.format)).toEqual(['gpx', 'nmea']);
    // The same file in UTF-8 reads the same.
    const plain = parseText(gpx, 'walk.gpx');
    expect(posted[0].res.ok && plain.ok && Array.from(posted[0].res.track.cols.t)).toEqual(plain.ok && Array.from(plain.track.cols.t));
  });

  it('read a UTF-16 file on this thread too, where there are no workers', async () => {
    vi.stubGlobal('Worker', undefined);
    vi.resetModules();
    const { parseFile } = await import('../../src/parse/client');
    const r = await parseFile(utf16(NMEA_TEXT, 'walk.nmea'));
    expect(r.ok && r.track.cols.n).toBe(6);
    const be = await parseFile(utf16(gpxDoc(`<trkseg>${trkpt(0)}${trkpt(1)}</trkseg>`), 'walk.gpx', true));
    expect(be.ok && be.track.cols.n).toBe(2);
  });

  it('count a file the reader fails on as unreadable on this thread too, and read the others', async () => {
    // As a worker does: one file's failure doesn't lose every file opened with it.
    vi.stubGlobal('Worker', undefined);
    vi.doMock('../../src/parse/index', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../src/parse/index')>();
      return { ...real, parseText: (text: string, file: string, size?: number) => { if (file === 'bad.gpx') throw new Error('the reader failed'); return real.parseText(text, file, size); } };
    });
    vi.resetModules();
    try {
      const { parseFile } = await import('../../src/parse/client');
      const gpx = gpxDoc(`<trkseg>${trkpt(0)}${trkpt(1)}</trkseg>`);
      const results = await Promise.all([parseFile(new File([gpx], 'walk.gpx')), parseFile(new File([gpx], 'bad.gpx'))]);
      expect(results[0].ok && results[0].track.cols.n).toBe(2);
      expect(results[1]).toEqual({ ok: false, file: 'bad.gpx', error: 'unreadable' });
    } finally {
      vi.doUnmock('../../src/parse/index');
    }
  });
});

/** A text saved as UTF-16 with its byte-order mark: little-endian (FF FE) or big-endian (FE FF). */
function utf16(text: string, name: string, bigEndian = false): File {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = bigEndian ? 0xfe : 0xff;
  bytes[1] = bigEndian ? 0xff : 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i), lo = c & 0xff, hi = c >> 8;
    bytes[2 + 2 * i] = bigEndian ? hi : lo;
    bytes[3 + 2 * i] = bigEndian ? lo : hi;
  }
  return new File([bytes], name);
}

/** The scanner's events, as short strings. */
function events(src: string) {
  const out: string[] = [];
  const r = scanXml(src, {
    open: (n, a, line) => out.push(`<${n}${[...a].map(([k, v]) => ` ${k}=${v}`).join('')}@${line}`),
    close: (n) => out.push(`</${n}`),
    text: (t) => out.push(`"${t}"`),
  });
  return { out, r };
}

describe('the XML scanner', () => {
  it('reads the attributes of a tag in one pass, however long a name without a value runs', () => {
    // How quickly (trying the name again from each of its characters took about 20 s): tests/unit/performance.test.ts.
    const { out } = events(`<gpx><trkpt ${'a'.repeat(200_000)}=x b="1"></trkpt></gpx>`);
    expect(out).toEqual(['<gpx@1', '<trkpt b=1@1', '</trkpt', '</gpx']);
  });

  it('reads the usual attributes as before', () => {
    const { out } = events('<trkpt lat="40.7812" lon=\'-73.9665\' gpxtpx:a = "1" b="x &amp; y"c="2" d="say \'hi\'" e=\'"q"\' t="1 > 0"/>');
    expect(out).toEqual(['<trkpt lat=40.7812 lon=-73.9665 a=1 b=x & y c=2 d=say \'hi\' e="q" t=1 > 0@1', '</trkpt']);
    expect(events('<gpx\n  version="1.1"\tcreator="Test"\r\n  xmlns:x="urn:test">').out).toEqual(['<gpx version=1.1 creator=Test x=urn:test@1']);
  });

  it('reads a "<" that can\'t start a tag as text', () => {
    expect(events('<a>x <5 y, 1<2, a <= b, < c</a>').out).toEqual(['<a@1', '"x "', '"<"', '"5 y, 1"', '"<"', '"2, a "', '"<"', '"= b, "', '"<"', '" c"', '</a']);
    // A "<" before a name, "/", "!" or "?" still starts markup, and one at the very end is a cut-off tag.
    expect(events('<a><_b/><:c/><é/></a>').out).toEqual(['<a@1', '<_b@1', '</_b', '<c@1', '</c', '<é@1', '</é', '</a']);
    expect(events('<a>x <').r).toEqual({ complete: false, wellFormed: true, line: 1 });
  });

  it('keeps reading a GPX file past a name with a "<" in it', () => {
    const p = parseGpx(gpxDoc(`<name>Pace <5 min/km</name><trkseg>${trkpt(0)}${trkpt(1)}${trkpt(2)}</trkseg>`));
    expect(p.name).toBe('Pace <5 min/km');
    expect(p.cols.n).toBe(3);
    expect(p.problems).toEqual([]);
  });
});

const s = (body: string) => `$${body}*${nmeaChecksum(body)}`;
const hms = (i: number) => `1305${String(i).padStart(2, '0')}.00`;
const lat = (i: number) => `4046.${String(8572 + i * 30).padStart(5, '0')}`;
const rmc = (i: number) => s(`GNRMC,${hms(i)},A,${lat(i)},N,07358.87242,W,1.0,45.0,140626,,,A,V`);
const gga = (i: number) => s(`GNGGA,${hms(i)},${lat(i)},N,07358.87242,W,1,09,0.9,25.4,M,-32.6,M,,`);
/** Six seconds of RMC and GGA, one sentence a line. */
const SENTENCES = Array.from({ length: 6 }, (_, i) => [rmc(i), gga(i)]).flat();
/** What a reading says about its fixes. */
const fixes = (text: string) => {
  const c = parseNmea(text).cols;
  return [c.t, c.lat, c.lon, c.ele, c.sats, c.hdop, c.speed, c.course].map((a) => Array.from(a));
};
/** The six seconds as a file, with CRLF line breaks. */
const NMEA_TEXT = SENTENCES.join('\r\n') + '\r\n';

describe('NMEA line breaks', () => {
  it('end a line at CR, LF or CRLF, so files with any of them read alike and without problems', () => {
    const lf = parseNmea(SENTENCES.join('\n') + '\n');
    expect(lf.cols.n).toBe(6);
    for (const br of ['\r', '\n\r', '\r\r\n', '\r\n']) {
      const text = SENTENCES.join(br) + br;
      expect(parseNmea(text).problems, JSON.stringify(br)).toEqual([]);
      expect(fixes(text), JSON.stringify(br)).toEqual(fixes(SENTENCES.join('\n') + '\n'));
    }
    // CR alone numbers the lines as LF does; LF CR and CR CR LF end an empty line after each one.
    expect(Array.from(parseNmea(SENTENCES.join('\r') + '\r').cols.line)).toEqual(Array.from(lf.cols.line));
    expect(Array.from(parseNmea(SENTENCES.join('\n\r') + '\n\r').cols.line)).toEqual([1, 5, 9, 13, 17, 21]);
    // A sentence with no checksum and no line break after it is cut off, unless a CR ends it.
    const plain = '$GPRMC,130500.00,A,4046.08572,N,07358.87242,W,1.0,10.0,140626,,,A';
    expect(parseNmea(`${plain}\r${plain.replace('130500', '130501')}\r`).problems).toEqual([]);
  });

  it('read CRLF and LF files as before, line numbers included', () => {
    for (const br of ['\n', '\r\n']) {
      const p = parseNmea(SENTENCES.join(br) + br);
      expect(Array.from(p.cols.line)).toEqual([1, 3, 5, 7, 9, 11]);
      expect(Array.from(p.cols.lineEnd)).toEqual([2, 4, 6, 8, 10, 12]);
      expect(p.lines).toBe(12);
      expect(p.problems).toEqual([]);
      // A cut-off last line counts its own characters, not the line break before it.
      const cut = parseNmea(SENTENCES.slice(0, 4).join(br) + br + SENTENCES[4].slice(0, 30));
      expect(cut.problems).toEqual([{ kind: 'truncated', line: 5, chars: 30, kept: 2 }]);
    }
  });

  it('take lines indented with spaces or tabs; anything else before a sentence is still garbage', () => {
    for (const indent of ['  ', '\t', ' \t ']) {
      const text = SENTENCES.map((l) => indent + l).join('\n') + '\n';
      expect(parseNmea(text).problems, JSON.stringify(indent)).toEqual([]);
      expect(fixes(text)).toEqual(fixes(SENTENCES.join('\n') + '\n'));
    }
    const junk = SENTENCES.map((l, i) => (i === 3 ? `x ${l}` : l)).join('\n') + '\n';
    expect(parseNmea(junk).problems).toEqual([{ kind: 'garbage', count: 1, line: 4 }]);
    expect(parseNmea(junk).cols.n).toBe(6);
  });

  it('are each looked for once, not again from every line', () => {
    // 200,000 blank lines (8 MB): a search for the next CR (or LF) from every line start would read the
    // rest of the file each time, seconds of work. The file has no CR; has one, at its very end; or has no LF.
    const blank = (br: string) => `${' '.repeat(40)}${br}`.repeat(200_000);
    // How quickly: tests/unit/performance.test.ts.
    for (const text of [rmc(0) + '\n' + blank('\n') + rmc(1) + '\n', rmc(0) + '\n' + blank('\n') + rmc(1) + '\n\r', rmc(0) + '\r' + blank('\r') + rmc(1) + '\r']) {
      const p = parseNmea(text);
      expect(p.cols.n).toBe(2);
      expect(p.problems).toEqual([]);
    }
  });
});

describe('NMEA fixes without a usable position', () => {
  it('count fixes at 0, 0 or off the Earth with the ones without a position', () => {
    const zero = s('GNRMC,130500.00,A,0000.00000,N,00000.00000,E,1.0,45.0,140626,,,A,V');
    const north = s('GNRMC,130501.00,A,9530.00000,N,07358.87242,W,1.0,45.0,140626,,,A,V');
    const p = parseNmea([zero, north, rmc(2), ''].join('\n'));
    expect(p.cols.n).toBe(1);
    expect(p.notes).toContainEqual({ kind: 'void', count: 2 });
  });
});

describe('NMEA stray bytes', () => {
  const clean = SENTENCES.join('\n') + '\n';
  /** The file with `stray` put into line 7 (the RMC of the fourth second) at `at`. */
  const withStray = (at: number, stray: string) => SENTENCES.map((l, i) => (i === 6 ? l.slice(0, at) + stray + l.slice(at) : l)).join('\n') + '\n';

  it('take a stray byte out wherever it is, and count its line as garbage', () => {
    // A byte that can never be in NMEA, in the sentence's name, a field, the checksum or after it: the line
    // is read without it. Inside a sentence, a tab or another kind of space is one too.
    const line = SENTENCES[6], star = line.lastIndexOf('*');
    for (const at of [1, 9, star - 1, star + 1, star + 2]) {
      for (const stray of ['\u0000', '\u007f', '\u00ff', '\u0085', '\t', '\u00a0', '\u2028', '\ud83d\ude00']) {
        const where = `${JSON.stringify(stray)} at ${at}`;
        expect(parseNmea(withStray(at, stray)).problems, where).toEqual([{ kind: 'garbage', count: 1, line: 7 }]);
        expect(fixes(withStray(at, stray)), where).toEqual(fixes(clean));
      }
    }
    // Before the $, any byte but space; after the checksum, any byte but a plain space, a tab too, as the
    // reader has always read them.
    const outside: [number, string[]][] = [[0, ['\u0000', '\u007f', '\u00ff', '\u0085']], [line.length, ['\u0000', '\u007f', '\u00ff', '\u0085', '\t', '\u00a0']]];
    for (const [at, strays] of outside) {
      for (const stray of strays) {
        const where = `${JSON.stringify(stray)} at ${at}`;
        expect(parseNmea(withStray(at, stray)).problems, where).toEqual([{ kind: 'garbage', count: 1, line: 7 }]);
        expect(fixes(withStray(at, stray)), where).toEqual(fixes(clean));
      }
    }
  });

  it('take a stray byte out of sentences glued together, and read the lines around them as they are', () => {
    for (const glue of ['\u0000', ' \u00ff ', '\t']) {
      const lines = [...SENTENCES.slice(0, 6), SENTENCES[6] + glue + SENTENCES[7], ...SENTENCES.slice(8)];
      const p = parseNmea(lines.join('\n') + '\n');
      expect(p.problems, JSON.stringify(glue)).toEqual([{ kind: 'glued', count: 1, line: 7 }, { kind: 'garbage', count: 1, line: 7 }]);
      expect(fixes(lines.join('\n') + '\n')).toEqual(fixes(clean));
      expect(Array.from(p.cols.line)).toEqual([1, 3, 5, 7, 8, 10]);
    }
  });
});

describe('NMEA fix quality', () => {
  /** One second: RMC with a mode letter and GGA with a fix quality ('' for none). */
  const second = (i: number, q: number | '', mode: string) => [
    s(`GNRMC,${hms(i)},A,${lat(i)},N,07358.87242,W,1.0,45.0,140626,,,${mode},V`),
    s(`GNGGA,${hms(i)},${lat(i)},N,07358.87242,W,${q},09,0.9,25.4,M,-32.6,M,,`),
  ];
  const quality = (...seconds: string[][]) => Array.from(parseNmea(seconds.flat().join('\n') + '\n').cols.fixq);

  it('counts estimated, manual and simulated positions as of unknown quality, not as GPS fixes', () => {
    // GGA quality 6 (estimated, dead reckoning), 7 (entered by hand) and 8 (simulated); 1 is a GPS fix.
    expect(quality(second(0, 6, 'A'), second(1, 7, 'A'), second(2, 8, 'A'), second(3, 1, 'A'))).toEqual([0, 0, 0, 1]);
    // The RMC modes E, M and S say the same.
    expect(quality(second(0, '', 'E'), second(1, '', 'M'), second(2, '', 'S'), second(3, '', 'A'))).toEqual([0, 0, 0, 1]);
    // Whichever of the two sentences says so.
    expect(quality(second(0, 1, 'E'), second(1, 2, 'S'), second(2, 2, 'D'))).toEqual([0, 0, 2]);
    // They are positions all the same: kept, without a fix quality to color by.
    const p = parseNmea(second(0, 6, 'E').join('\n') + '\n');
    expect(p.cols.n).toBe(1);
    expect(p.fields).not.toContain('fix');
  });
});

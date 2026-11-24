// Reading files that are odd or hostile without losing them, hanging or
// freezing: the reading workers, the XML scanner and NMEA line breaks. All
// positions are synthetic, in New York City.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanXml } from '../../src/parse/xml';
import { parseGpx } from '../../src/parse/gpx';
import { nmeaChecksum, parseNmea } from '../../src/parse/nmea';
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
});

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

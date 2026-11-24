import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { initialLang, MESSAGES, placeholders, translate } from '../../src/i18n/i18n';
import { MEASURES, type FieldKey, type Note, type ParseResult, type Problem, type SpeedUnit } from '../../src/model/types';
import { BASEMAP_IDS } from '../../src/map/basemaps';
import type { Units } from '../../src/format';
import type { scaleBar } from '../../src/ui/scaleBar';
import { ROOT } from '../helpers/fixtures';
import * as S from '../../src/state/store';
import { labeled, noteText } from '../../src/ui/labels';
import { searchZones } from '../../src/time/zones';

const en = MESSAGES.en, zh = MESSAGES.zh;

/** Every value of a string union, checked by the compiler: one missing, or one too many, doesn't compile. */
const every = <K extends string>(values: Record<K, true>) => Object.keys(values) as K[];

/**
 * Every key the code builds at run time (`measure.${key}`, `problem.${kind}.title`…), each listed in full
 * from the values it's built from, so a key nothing builds counts as unused.
 */
function builtKeys(): Set<string> {
  const problems = every<Problem['kind']>({ truncated: true, checksum: true, glued: true, garbage: true, badRows: true, backwards: true, jump: true, unclosed: true, badXml: true, noFixes: true });
  const notes = every<Note['kind']>({
    speedUnit: true, speedDerived: true, hdopRelative: true, ignored: true, void: true, timeless: true, duplicates: true, noZone: true,
    noDate: true, midnight: true, timelessWaypoints: true, gaps: true, eleZero: true, zeroSats: true, route: true, motion: true, repeatsDropped: true,
  });
  const fields = every<FieldKey>({ time: true, position: true, ele: true, speed: true, course: true, hdop: true, vdop: true, pdop: true, sats: true, fix: true, geoid: true, accel: true, flags: true });
  // The extension fields a file can have that the app doesn't use, named in the "Not used" note (gpx.ts, nmea.ts).
  const unused = ['satsInView', 'heartRate', 'cadence', 'temperature', 'power', 'depth', 'distance'];
  const speedUnits = every<SpeedUnit>({ ms: true, kmh: true, knots: true, mph: true });
  const scaleUnits = every<ReturnType<typeof scaleBar>['unit']>({ m: true, km: true, ft: true, mi: true });
  const errors = every<Extract<ParseResult, { ok: false }>['error']>({ unknownFormat: true, empty: true, tooBig: true, unreadable: true });
  const units = every<Units>({ metric: true, imperial: true });
  return new Set([
    ...[...MEASURES, 'none'].map((k) => `measure.${k}`), ...MEASURES.map((k) => `measure.${k}.long`),
    ...[...MEASURES, 'hdopRelative'].map((k) => `halo.hint.${k}`),
    ...BASEMAP_IDS.map((k) => `basemap.${k}`),
    ...problems.flatMap((k) => [`problem.${k}.title`, `problem.${k}.body`]),
    ...notes.map((k) => `note.${k}`),
    ...[...fields, ...unused].map((k) => `field.${k}`),
    ...[...speedUnits, ...scaleUnits].map((k) => `unit.${k}`),
    ...errors.map((k) => `toast.error.${k}`),
    ...units.map((k) => `settings.${k}`),
  ]);
}

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe('translations', () => {
  it('defines each key once in each file (a second one would quietly replace the first)', () => {
    for (const f of ['en-US.json', 'zh-CN.json']) {
      const keys = [...readFileSync(join(ROOT, 'src', 'i18n', f), 'utf8').matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
      expect(keys.filter((k, i) => keys.indexOf(k) !== i), f).toEqual([]);
    }
  });

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

  it('describes reading problems in words that fit every format', () => {
    // A Columbus Fusion log can end mid-line too, and its lines have no checksums.
    const cut = { line: 9, chars: 12, kept: 8 };
    expect(translate('en', 'problem.truncated.body', cut)).toBe('Line 9 stops after 12 characters, without a line break: the logger probably stopped mid-write. That line was skipped; the 8 fixes before it loaded.');
    expect(translate('zh', 'problem.truncated.body', cut)).toBe('第 9 行只有 12 个字符，没有换行：记录器很可能在写入时停止了。这一行已跳过；之前的 8 个定位点已载入。');
    expect(translate('en', 'problem.badRows.title', { n: 1 })).toBe('1 row skipped');
    expect(translate('en', 'problem.badRows.title', { n: 4 })).toBe('4 rows skipped');
    expect(translate('zh', 'problem.badRows.title', { n: 4 })).toBe('4 行已跳过');
    expect(translate('zh', 'problem.badRows.body', { line: 3 })).toBe('从第 3 行开始，字段数量不对的行已跳过。');
    expect(translate('en', 'note.timeless', { n: 1 })).toBe('1 fix without a time was skipped.');
    expect(translate('zh', 'note.timeless', { n: 3 })).toBe('跳过了 3 个没有时间的定位点。');
  });

  it('counts the fixes with 0 satellites and the ones that repeat a position, each with its own plural', () => {
    const note = (lang: 'en' | 'zh', count: number, stale: number) => { S.lang.value = lang; return noteText({ kind: 'zeroSats', count, stale }); };
    expect(note('en', 1, 0)).toBe('1 fix reports 0 satellites used.');
    expect(note('en', 5, 0)).toBe('5 fixes report 0 satellites used.');
    expect(note('en', 5, 1)).toBe('5 fixes report 0 satellites used; 1 of them repeats the previous position.');
    expect(note('en', 5, 3)).toBe('5 fixes report 0 satellites used; 3 of them repeat the previous position.');
    expect(note('en', 1, 1)).toBe('1 fix reports 0 satellites used and repeats the previous position.');
    expect(note('en', 5, 5)).toBe('5 fixes report 0 satellites used; all of them repeat the previous position.');
    expect(note('zh', 5, 1)).toBe('有 5 个定位点报告使用了 0 颗卫星；其中 1 个重复了上一个位置。');
    expect(note('zh', 5, 5)).toBe('有 5 个定位点报告使用了 0 颗卫星，并且重复了上一个位置。');
    S.lang.value = 'en';
  });

  it("says whether a speed unit is the file's own, the one its numbers match, a guess, or picked", () => {
    const text = (lang: 'en' | 'zh', n: Note) => { S.lang.value = lang; return noteText(n); };
    const unit = (u: SpeedUnit, inferred: boolean, more: { unsure?: true; chosen?: true } = {}): Note => ({ kind: 'speedUnit', unit: u, inferred, ...more });
    expect(text('en', unit('knots', false))).toBe('The file records speed in knots.');
    expect(text('en', unit('kmh', true))).toBe("The file doesn't say which unit its speed uses; the numbers match km/h.");
    expect(text('en', unit('ms', true, { unsure: true }))).toBe(
      "The file doesn't say which unit its speed uses, and comparing it with the positions didn't settle it, so it was read as m/s. Change that under “Speed unit of the file”.");
    expect(text('en', unit('kmh', true, { chosen: true }))).toBe("The file doesn't say which unit its speed uses; you picked km/h.");
    expect(text('zh', unit('kmh', true))).toBe('文件没有注明速度单位；根据数值判断为 km/h。');
    expect(text('zh', unit('ms', true, { unsure: true }))).toBe('文件没有注明速度单位，与位置比对也无法确定，因此按 m/s 读取。可在“文件的速度单位”中更改。');
    expect(text('zh', unit('knots', true, { chosen: true }))).toBe('文件没有注明速度单位；你选择了 节。');
    // The guess names the properties page's section by its heading.
    for (const lang of ['en', 'zh'] as const) expect(text(lang, unit('ms', true, { unsure: true }))).toContain(`“${translate(lang, 'details.speedUnit')}”`);
    S.lang.value = 'en';
  });

  it('joins a label and its text with each language\'s own colon', () => {
    S.lang.value = 'zh';
    expect(labeled('距离', '相邻定位点之间')).toBe('距离：相邻定位点之间');
    S.lang.value = 'en';
    expect(labeled('Distance', 'between fixes')).toBe('Distance: between fixes');
  });

  it('says in Chinese that the time zones are searched by their English names, as the search works', () => {
    expect(translate('zh', 'zone.search')).toBe('按时区名称（英文）或时差搜索');
    expect(searchZones('上海', 0)).toEqual([]);
    expect(searchZones('shanghai', 0).map((z) => z.id)).toContain('Asia/Shanghai');
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
    // Messages read in a given language rather than the current one: translate(lang, 'key').
    for (const m of src.matchAll(/\btranslate\(\s*[\w!.]+\s*,\s*'([\w.]+)'/g)) used.add(m[1]);
    // One of two keys: t(cond ? 'a' : 'b').
    for (const m of src.matchAll(/\bt\(\s*[\w.!]+\s*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)) used.add(m[1]).add(m[2]);
    for (const k of used) expect(en[k], `missing message ${k}`).toBeDefined();
    // Keys built at run time, listed in full; each prefix the code builds keys from is listed there.
    const built = builtKeys();
    for (const k of built) expect(en[k], `missing message ${k}`).toBeDefined();
    const prefixes = new Set([...src.matchAll(/\bt\(\s*`([\w.]+)\$\{/g)].map((m) => m[1]));
    expect([...prefixes].sort()).toEqual(['basemap.', 'field.', 'halo.hint.', 'measure.', 'note.', 'problem.', 'settings.', 'toast.error.', 'unit.']);
    expect(Object.keys(en).filter((k) => !used.has(k) && !built.has(k))).toEqual([]);
  });

  it('keeps interface text out of the components', () => {
    // Text between tags in JSX must come from the message files. Allowed: the
    // format names, the language names and symbols.
    const allowed = new Set(['GPX', 'NMEA', 'Columbus Fusion', 'EN', '中文', 'UTC', 'HDOP', 'VDOP', 'PDOP', '#', '×', '✓', '–', '9']);
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

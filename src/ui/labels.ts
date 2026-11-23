// Text built from data: legend ranges, units and readout values.
import type { ColorKey, HaloKey, MeasureKey, Note, Problem, Format } from '../model/types';
import type { Scale } from '../color/scale';
import { fmtEle, fmtNum, fmtSpeed } from '../format';
import { locale, t, units } from '../state/store';

export function unitOf(key: MeasureKey): string {
  const imp = units.value === 'imperial';
  if (key === 'speed') return imp ? t('unit.mph') : t('unit.kmh');
  if (key === 'ele') return imp ? t('unit.ft') : t('unit.m');
  if (key === 'grade') return '%';
  if (key === 'accel') return t('unit.g');
  return '';
}

/** A file format's name, as people know it. */
export function formatName(f: Format): string {
  return f === 'gpx' ? 'GPX' : f === 'nmea' ? 'NMEA' : f === 'fusion' ? 'Columbus Fusion' : t('format.combined');
}

export function measureName(key: ColorKey | HaloKey): string {
  return t(`measure.${key}`);
}

/** Legend title: "Speed (km/h)", "HDOP, ranked within this track". */
export function measureTitle(key: MeasureKey, relative = false): string {
  if (key === 'hdop' && relative) return t('legend.hdopRelative');
  const u = unitOf(key);
  return u && key !== 'grade' ? t('legend.withUnit', { name: measureName(key), unit: u }) : key === 'grade' ? t('legend.grade') : measureName(key);
}

function digitsFor(edges: number[]): number {
  if (edges.every((e) => Number.isInteger(e))) return 0;
  if (edges.every((e) => Number.isInteger(e * 10))) return 1;
  return 2;
}

/** Labels for each step of a scale, in display units. */
export function stepLabels(s: Scale): string[] {
  const loc = locale.value;
  if (s.key === 'fix') return [t('fix.gps'), t('fix.corrected')];
  const d = digitsFor(s.edges);
  const f = (v: number) => fmtNum(v, loc, d, d);
  const e = s.edges;
  if (s.key === 'sats') return [`≥ ${f(e[0])}`, `${f(e[1])}–${f(e[0] - 1)}`, `${f(e[2])}–${f(e[1] - 1)}`, `≤ ${f(e[2] - 1)}`];
  const out = [`< ${f(e[0])}`];
  for (let k = 1; k < e.length; k++) out.push(`${f(e[k - 1])}–${f(e[k])}`);
  out.push(`≥ ${f(e[e.length - 1])}`);
  return out;
}

/** A value for the readout and inspector, with its unit. */
export function valueText(key: MeasureKey, v: number): string {
  const loc = locale.value;
  if (!Number.isFinite(v)) return '–';
  switch (key) {
    case 'speed': return `${fmtSpeed(v, units.value, loc)} ${unitOf('speed')}`;
    case 'ele': return `${fmtEle(v, units.value, loc)} ${unitOf('ele')}`;
    case 'grade': return `${v > 0 ? '+' : ''}${fmtNum(v, loc, 1, 1)}%`;
    case 'hdop': return fmtNum(v, loc, 1, 1);
    case 'sats': return t('readout.sats', { n: v });
    case 'fix': return v >= 2 ? t('fix.corrected') : t('fix.gps');
    case 'accel': return `${fmtNum(v, loc, 2, 2)} ${t('unit.g')}`;
  }
}

export function problemTitle(p: Problem): string {
  return t(`problem.${p.kind}.title`, p.kind === 'noFixes' ? undefined : { n: 'count' in p ? p.count : 0 });
}

export function problemBody(p: Problem): string {
  switch (p.kind) {
    case 'truncated': return t('problem.truncated.body', { line: p.line, chars: p.chars, kept: p.kept });
    case 'checksum': case 'glued': case 'garbage': case 'backwards': case 'jump':
      return t(`problem.${p.kind}.body`, { n: p.count, line: p.line });
    case 'unclosed': return t('problem.unclosed.body', { kept: p.kept });
    case 'badXml': return t('problem.badXml.body', { line: p.line, kept: p.kept });
    case 'noFixes': return t('problem.noFixes.body');
  }
}

/** A field's name; unknown extension fields keep the name they have in the file. */
export function fieldName(f: string): string {
  const s = t(`field.${f}`);
  return s === `field.${f}` ? f : s;
}

export function noteText(n: Note): string {
  switch (n.kind) {
    case 'speedUnit': return t(n.inferred ? 'note.speedUnitInferred' : 'note.speedUnit', { unit: t(`unit.${n.unit}`) });
    case 'ignored': return t('note.ignored', { fields: n.fields.map(fieldName).join(t('list.sep')) });
    case 'void': case 'duplicates': case 'timelessWaypoints': return t(`note.${n.kind}`, { n: n.count });
    case 'gaps': return t('note.gaps', { n: n.count, longest: Math.round(n.longestS) });
    case 'zeroSats': return t('note.zeroSats', { n: n.count, stale: n.stale });
    case 'motion': return t('note.motion', { n: n.rate });
    default: return t(`note.${n.kind}`);
  }
}

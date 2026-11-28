// Text built from data: legend ranges, units and readout values.
import type { ColorKey, MeasureKey, Note, Problem, Format, LoadedTrack } from '../model/types';
import type { Scale } from '../color/scale';
import { fmtBytes, fmtDuration, fmtEle, fmtNum, fmtSpeed } from '../format';
import { locale, t, units } from '../state/store';
import { trackName, type TrackItem } from '../state/logic';
import { isCombined } from '../combine/combine';

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

/** The line under a track's name on its properties page: "GPX · 438 KB · its creator · the name in the file"; for a combined track, how many sources. */
export function trackTagline(tr: LoadedTrack): string {
  const parts = isCombined(tr) ? [formatName(tr.format), t('combine.logs', { n: tr.combo.sources.length })] : [formatName(tr.format), fmtBytes(tr.sizeBytes, locale.value), tr.creator, tr.name];
  return parts.filter(Boolean).join(' · ');
}

/** What a renamed track was called: its file's name ("File name: …"), or a combined track's first name. */
export function originalName(tr: LoadedTrack): string {
  return isCombined(tr) ? t('track.origName', { name: tr.file }) : t('track.fileName', { file: tr.file });
}

/** A track name's hover text, one line each: its name in full, what it was called when renamed, its tagline. */
export function nameTip(item: TrackItem): string {
  return [trackName(item), item.customName !== undefined ? originalName(item.track) : '', trackTagline(item.track)].filter(Boolean).join('\n');
}

/** A measure's name, or "One color" for a one-color line (no halo has a name of its own: callers say "None"). */
export function measureName(key: ColorKey): string {
  return t(`measure.${key}`);
}

/** A label and what it labels, as one text for a hover text or a screen reader: "Distance: …" ("距离：…" in Chinese). */
export function labeled(label: string, text: string): string {
  return `${label}${t('label.sep')}${text}`;
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

/**
 * A count for a message, grouped as the language writes numbers ("12,345").
 * translate() still picks the plural form from it: below 1,000 it reads back
 * as the count itself, and a grouped number reads as no number at all, which
 * gets the "other" form: the right one for counts that large in English and Chinese.
 */
function grouped(n: number): string {
  return fmtNum(n, locale.value, 0, 0);
}

export function problemTitle(p: Problem): string {
  return t(`problem.${p.kind}.title`, p.kind === 'noFixes' ? undefined : { n: grouped('count' in p ? p.count : 0) });
}

export function problemBody(p: Problem): string {
  switch (p.kind) {
    case 'truncated': return t('problem.truncated.body', { line: p.line, chars: grouped(p.chars), kept: grouped(p.kept) });
    case 'checksum': case 'glued': case 'garbage': case 'badRows': case 'backwards': case 'jump':
      return t(`problem.${p.kind}.body`, { n: grouped(p.count), line: p.line });
    case 'unclosed': return t('problem.unclosed.body', { kept: grouped(p.kept) });
    case 'badXml': return t('problem.badXml.body', { line: p.line, kept: grouped(p.kept) });
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
    case 'speedUnit': {
      // A unit the file doesn't give: picked by the user, a guess the positions didn't settle, or what they match.
      const unit = { unit: t(`unit.${n.unit}`) };
      if (n.inferred && n.chosen) return t('note.speedUnitChosen', unit);
      if (n.inferred && n.unsure) return t('note.speedUnitGuess', unit);
      return t(n.inferred ? 'note.speedUnitInferred' : 'note.speedUnit', unit);
    }
    case 'ignored': return t('note.ignored', { fields: n.fields.map(fieldName).join(t('list.sep')) });
    case 'void': case 'timeless': case 'duplicates': case 'timelessWaypoints': return t(`note.${n.kind}`, { n: grouped(n.count) });
    // The longest gap as the Duration row writes a time: "12:00:10".
    case 'gaps': return t('note.gaps', { n: grouped(n.count), longest: fmtDuration(n.longestS) });
    case 'zeroSats': return zeroSatsText(n.count, n.stale);
    case 'motion': return t('note.motion', { n: n.rate });
    case 'repeatsDropped': {
      const dropped = t('note.repeatsDropped', { n: grouped(n.count) });
      return n.long ? `${dropped} ${t('note.repeatsLong', { n: grouped(n.long) })}` : dropped;
    }
    default: return t(`note.${n.kind}`);
  }
}

/**
 * Fixes that report 0 satellites, and how many of them repeat the position
 * before: each count with its own plural ("1 of them repeats", "3 of them repeat").
 */
function zeroSatsText(count: number, stale: number): string {
  if (stale <= 0) return t('note.zeroSats', { n: grouped(count) });
  if (stale >= count) return t('note.zeroSatsAllStale', { n: grouped(count) });
  return t('note.zeroSatsStale', { count: grouped(count), n: grouped(stale) });
}

/** A short distance: metres (feet in imperial units), with a decimal below 10. */
export function metresText(m: number): string {
  const v = m * (units.value === 'imperial' ? 3.28084 : 1);
  const d = v < 10 ? 1 : 0;
  return `${fmtNum(v, locale.value, d, d)} ${unitOf('ele')}`;
}

export type Units = 'metric' | 'imperial';

const KMH_TO_MPH = 1 / 1.609344;
const M_TO_FT = 3.28084;

const nf = new Map<string, Intl.NumberFormat>();
/**
 * A number with at most `digits` decimals. A value that rounds to zero is
 * shown as 0, never "-0": anything closer to zero than half the last digit
 * (Intl rounds halves away from zero, so -0.05 still shows as "-0.1").
 */
export function fmtNum(v: number, locale: string, digits = 1, minDigits = digits): string {
  if (!Number.isFinite(v)) return '–';
  const key = `${locale}|${digits}|${minDigits}`;
  let f = nf.get(key);
  if (!f) { f = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: minDigits }); nf.set(key, f); }
  return f.format(v <= 0 && -v < 0.5 / 10 ** digits ? 0 : v);
}

/** Multiply km/h by this to get the display unit. */
export const speedFactor = (u: Units) => (u === 'imperial' ? KMH_TO_MPH : 1);
/** Multiply meters (elevation) by this to get the display unit. */
export const eleFactor = (u: Units) => (u === 'imperial' ? M_TO_FT : 1);

export function fmtSpeed(kmh: number, u: Units, locale: string, digits = 1): string {
  return fmtNum(kmh * speedFactor(u), locale, digits);
}

export function fmtEle(m: number, u: Units, locale: string): string {
  return fmtNum(m * eleFactor(u), locale, 0, 0);
}

/** Distance in km (or miles), with one decimal below 100. */
export function fmtDistance(m: number, u: Units, locale: string): string {
  const v = u === 'imperial' ? m / 1609.344 : m / 1000;
  return fmtNum(v, locale, v < 100 ? 1 : 0, v < 100 ? 1 : 0);
}

/** "1:02:03" or "2:03". */
export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return '–';
  const t = Math.round(Math.abs(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (s < 0 ? '−' : '') + (h ? `${h}:` : '') + `${mm}:${String(sec).padStart(2, '0')}`;
}

export function fmtBytes(b: number, locale: string): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${fmtNum(b / 1024, locale, 0, 0)} KB`;
  return `${fmtNum(b / 1024 / 1024, locale, 1, 1)} MB`;
}

export function fmtPercent(f: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(f);
}

/** 'local' (this computer's zone), 'utc', or any IANA zone id. */
export type ZoneSel = string;

const cache = new Map<string, Intl.DateTimeFormat>();

function dtf(locale: string, zone: ZoneSel, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + '|' + zone + '|' + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: zoneId(zone) });
    cache.set(key, f);
  }
  return f;
}

/** The IANA id to pass to Intl, or undefined for this computer's zone. */
export function zoneId(z: ZoneSel): string | undefined {
  if (z === 'local') return undefined;
  if (z === 'utc') return 'UTC';
  return z;
}

export function localZoneId(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Whether Intl knows the zone. */
export function isValidZone(z: string): boolean {
  if (z === 'local' || z === 'utc') return true;
  try { return Intl.DateTimeFormat('en-US', { timeZone: z }).resolvedOptions().timeZone.length > 0; } catch { return false; }
}

/** Clock time: 12-hour in English ("1:05:09 PM"), 24-hour in Chinese ("13:05:09"). */
export function fmtClock(t: number, zone: ZoneSel, locale: string, seconds = true): string {
  const h12 = !locale.startsWith('zh');
  return dtf(locale, zone, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined, hourCycle: h12 ? 'h12' : 'h23' }).format(t);
}

/** Short date and clock time, "Jul 12, 12:05:09 AM" or "7月12日 00:05:09". */
export function fmtDateClock(t: number, zone: ZoneSel, locale: string, seconds = true): string {
  return `${fmtShortDate(t, zone, locale)}${locale.startsWith('zh') ? ' ' : ', '}${fmtClock(t, zone, locale, seconds)}`;
}

/** Whether two times fall on different calendar days in a zone. */
export function differentDays(a: number, b: number, zone: ZoneSel): boolean {
  const f = dtf('en-CA', zone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(a) !== f.format(b);
}

/** Whether a time is exactly midnight in a zone. */
export function isMidnight(t: number, zone: ZoneSel): boolean {
  const local = t + offsetMinutes(t, zone) * 60_000;
  return ((local % 86_400_000) + 86_400_000) % 86_400_000 === 0;
}

/** Date with weekday, "Sun, Jun 14, 2026" or "2026年6月14日周日". */
export function fmtDate(t: number, zone: ZoneSel, locale: string): string {
  return dtf(locale, zone, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).format(t);
}

/** Short date, "Jun 14" or "6月14日". */
export function fmtShortDate(t: number, zone: ZoneSel, locale: string): string {
  return dtf(locale, zone, { month: 'short', day: 'numeric' }).format(t);
}

/** "UTC−4", "UTC+5:30" or "UTC" for the zone's offset at time t. */
export function offsetLabel(t: number, zone: ZoneSel): string {
  const parts = dtf('en-US', zone, { timeZoneName: 'shortOffset' }).formatToParts(t);
  const name = (parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT').replace('GMT', 'UTC').replace('-', '−');
  return /^UTC([+−]0(:00)?)?$/.test(name) ? 'UTC' : name;
}

/** Offset of the zone from UTC at time t, in minutes. */
export function offsetMinutes(t: number, zone: ZoneSel): number {
  const label = offsetLabel(t, zone);
  const m = /UTC([+−])(\d{1,2})(?::(\d\d))?/.exec(label);
  if (!m) return 0;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '−' ? -v : v;
}

/** "America/New_York" → "New York". */
export function zoneCity(id: string): string {
  if (id === 'UTC' || id === 'utc') return 'UTC';
  const last = id.split('/').pop() ?? id;
  return last.replace(/_/g, ' ');
}

/** Long localized zone name, "Eastern Daylight Time" or "北美东部夏令时间". */
export function zoneLongName(t: number, zone: ZoneSel, locale: string): string {
  const parts = dtf(locale, zone, { timeZoneName: 'long' }).formatToParts(t);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

const FALLBACK_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage',
  'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Athens', 'Europe/Moscow',
  'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth',
  'Australia/Sydney', 'Pacific/Auckland',
];

/** Every zone the browser knows. */
export function allZones(): string[] {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  try {
    const list = sv ? sv('timeZone') : FALLBACK_ZONES;
    return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    return FALLBACK_ZONES;
  }
}

export interface ZoneOption { id: string; city: string; offset: string; minutes: number }

/** Zones matching a search, sorted by offset, with offsets on the given date. */
export function searchZones(query: string, t: number): ZoneOption[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const out: ZoneOption[] = [];
  for (const id of allZones()) {
    const city = zoneCity(id);
    const offset = offsetLabel(t, id);
    if (q && !id.toLowerCase().replace(/_/g, ' ').includes(q) && !offset.toLowerCase().replace('−', '-').includes(q.replace('−', '-'))) continue;
    out.push({ id, city, offset, minutes: offsetMinutes(t, id) });
  }
  return out.sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city));
}

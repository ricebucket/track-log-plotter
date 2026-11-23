// Logs that run past midnight or over more than one day.
import { describe, expect, it } from 'vitest';
import { load } from '../helpers/fixtures';
import { differentDays, fmtDateClock, isMidnight, offsetMinutes } from '../../src/time/zones';
import { ticks } from '../../src/ui/timelineMath';

const NY = 'America/New_York';
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('a log over two days', () => {
  // An evening ride (7:30 PM in New York, past midnight UTC) and the ride back
  // the next morning, with a night's stop between them.
  const tr = load('hudson-overnight.gpx');
  const c = tr.cols, st = tr.derived.stats;

  it('reads both days, in order, with the night as a gap', () => {
    expect(tr.problems).toEqual([]);
    expect(c.n).toBeGreaterThan(1000);
    for (let i = 1; i < c.n; i++) expect(c.t[i] > c.t[i - 1], `fix ${i} after fix ${i - 1}`).toBe(true);
    const night = c.t.findIndex((t, i) => i > 0 && t - c.t[i - 1] > 3_600_000);
    expect(night).toBeGreaterThan(0);
    expect((c.t[night] - c.t[night - 1]) / 3_600_000).toBeGreaterThan(7);
    expect(tr.derived.gap[night]).toBe(1);
  });

  it('counts the whole span as duration but only the riding as moving time', () => {
    expect(st.durationS / 3600).toBeGreaterThan(13);
    expect(st.movingS / 3600).toBeLessThan(2);
    expect(st.movingS / 3600).toBeGreaterThan(1);
  });

  it('spans two dates in New York and in UTC', () => {
    expect(differentDays(st.start, st.end, NY)).toBe(true);
    expect(differentDays(st.start, st.end, 'utc')).toBe(true);
    expect(plain(fmtDateClock(st.start, NY, 'en-US'))).toBe('Jul 11, 7:30:00 PM');
    expect(fmtDateClock(st.end, NY, 'zh-CN')).toMatch(/^7月12日 08:\d{2}:\d{2}$/);
  });

  it('puts a date tick at midnight on the timeline', () => {
    const list = ticks(st.start, st.end, 800, offsetMinutes(st.start, NY));
    const midnights = list.filter((t) => isMidnight(t, NY));
    expect(midnights).toHaveLength(1);
    expect(new Date(midnights[0]).toISOString()).toBe('2026-07-12T04:00:00.000Z');
  });
});

describe('a log that crosses midnight UTC', () => {
  const tr = load('hudson-greenway-evening.log');
  it('keeps every fix in order across midnight', () => {
    expect(tr.problems).toEqual([]);
    for (let i = 1; i < tr.cols.n; i++) expect(tr.cols.t[i] > tr.cols.t[i - 1]).toBe(true);
    expect(differentDays(tr.derived.stats.start, tr.derived.stats.end, 'utc')).toBe(true);
    // The same ride is one evening in New York.
    expect(differentDays(tr.derived.stats.start, tr.derived.stats.end, NY)).toBe(false);
  });
});

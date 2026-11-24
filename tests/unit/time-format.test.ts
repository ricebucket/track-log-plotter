import { describe, expect, it } from 'vitest';
import { allZones, fmtClock, fmtDate, isValidZone, offsetLabel, offsetMinutes, searchZones, zoneCity, zoneId } from '../../src/time/zones';
import { fmtBytes, fmtDistance, fmtDuration, fmtEle, fmtNum, fmtPercent, fmtSpeed } from '../../src/format';
import { googleBaseFor, googleViewUrl, streetViewUrl } from '../../src/links/google';

const t = Date.UTC(2026, 5, 14, 13, 5, 9); // 09:05:09 in New York (UTC−4)

describe('time zones', () => {
  it('formats clock times in the chosen zone: 12-hour in English, 24-hour in Chinese', () => {
    // Intl puts a narrow no-break space before AM and PM.
    const en = (z: Parameters<typeof fmtClock>[1], s = true) => fmtClock(t, z, 'en-US', s).replace(/\s/g, ' ');
    expect(en('utc')).toBe('1:05:09 PM');
    expect(en('America/New_York')).toBe('9:05:09 AM');
    expect(en('Europe/London', false)).toBe('2:05 PM');
    expect(fmtClock(t, 'Asia/Tokyo', 'zh-CN')).toBe('22:05:09');
    expect(fmtClock(t, 'America/New_York', 'zh-CN')).toBe('09:05:09');
    expect(fmtClock(t, 'utc', 'zh-CN', false)).toBe('13:05');
  });

  it('formats dates in both languages', () => {
    expect(fmtDate(t, 'America/New_York', 'en-US')).toBe('Sun, Jun 14, 2026');
    expect(fmtDate(t, 'America/New_York', 'zh-CN')).toContain('2026年6月14日');
  });

  it('labels offsets on the track\'s date', () => {
    expect(offsetLabel(t, 'America/New_York')).toBe('UTC−4');
    expect(offsetLabel(Date.UTC(2026, 0, 14), 'America/New_York')).toBe('UTC−5');
    expect(offsetLabel(t, 'utc')).toBe('UTC');
    expect(offsetLabel(t, 'Asia/Kolkata')).toBe('UTC+5:30');
    expect(offsetMinutes(t, 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutes(t, 'America/New_York')).toBe(-240);
  });

  it('names zones and searches them', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneId('local')).toBeUndefined();
    expect(zoneId('utc')).toBe('UTC');
    expect(isValidZone('Europe/London')).toBe(true);
    expect(isValidZone('Nowhere/Land')).toBe(false);
    expect(allZones()).toContain('UTC');
    const hits = searchZones('london', t);
    expect(hits.map((z) => z.id)).toContain('Europe/London');
    const sorted = searchZones('', t);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].minutes).toBeGreaterThanOrEqual(sorted[i - 1].minutes);
  });
});

describe('formatting', () => {
  it('formats numbers, speeds, distances and elevations', () => {
    expect(fmtNum(1234.56, 'en-US', 1)).toBe('1,234.6');
    expect(fmtSpeed(18.25, 'metric', 'en-US')).toBe('18.3');
    expect(fmtSpeed(16.09344, 'imperial', 'en-US')).toBe('10.0');
    expect(fmtDistance(12_345, 'metric', 'en-US')).toBe('12.3');
    expect(fmtDistance(1609.344, 'imperial', 'en-US')).toBe('1.0');
    expect(fmtEle(10, 'imperial', 'en-US')).toBe('33');
    expect(fmtNum(NaN, 'en-US')).toBe('–');
  });

  it('never shows a negative zero, and rounds everything else as before', () => {
    expect(fmtEle(-0.3, 'metric', 'en-US')).toBe('0');
    expect(fmtSpeed(-0.02, 'metric', 'en-US')).toBe('0.0');
    expect(fmtNum(-0, 'en-US', 1)).toBe('0.0');
    expect(fmtNum(-0.049, 'zh-CN', 1)).toBe('0.0');
    expect(fmtNum(-0.004, 'en-US', 2, 0)).toBe('0');
    // Halves still round away from zero.
    expect(fmtNum(-0.05, 'en-US', 1)).toBe('-0.1');
    expect(fmtNum(-2.5, 'en-US', 0)).toBe('-3');
    expect(fmtNum(-1234.56, 'en-US', 1)).toBe('-1,234.6');
  });

  it('formats durations, sizes and shares', () => {
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(3723)).toBe('1:02:03');
    expect(fmtDuration(-30)).toBe('−0:30');
    expect(fmtBytes(512, 'en-US')).toBe('512 B');
    expect(fmtBytes(420_000, 'en-US')).toBe('410 KB');
    expect(fmtPercent(0.256, 'en-US')).toBe('26%');
  });
});

describe('Google Maps links', () => {
  it('opens the same view in the matching Google map', () => {
    expect(googleBaseFor('satellite')).toBe('satellite');
    expect(googleBaseFor('hybrid')).toBe('satellite');
    expect(googleBaseFor('topo')).toBe('terrain');
    expect(googleBaseFor('osm')).toBe('roadmap');
    // MapLibre's zoom 14.4 (512-pixel tiles) is Google's 15.4 (256-pixel tiles): the same scale on screen.
    expect(googleViewUrl(40.7705, -73.9655, 14.4, 'satellite')).toBe('https://www.google.com/maps/@?api=1&map_action=map&center=40.770500%2C-73.965500&zoom=15&basemap=satellite');
    // Within the zooms Google takes.
    expect(googleViewUrl(40.7705, -73.9655, 20.8, 'roadmap')).toContain('&zoom=21&');
    expect(googleViewUrl(40.7705, -73.9655, -1, 'roadmap')).toContain('&zoom=0&');
  });

  it('opens Street View at the cursor, facing the direction of travel', () => {
    expect(streetViewUrl(40.7705, -73.9655, 370)).toBe('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=40.770500%2C-73.965500&heading=10');
    expect(streetViewUrl(40.7705, -73.9655)).not.toContain('heading');
  });
});

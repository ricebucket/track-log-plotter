// The synthetic lower Manhattan walk: a GPX file with every field filled in.
import { describe, expect, it } from 'vitest';
import { load } from '../helpers/fixtures';

const tr = load('lower-manhattan-walk.gpx');
const c = tr.cols;
const meters = (lat1: number, lon1: number, lat2: number, lon2: number) => Math.hypot((lat2 - lat1) * 111320, (lon2 - lon1) * 111320 * Math.cos((lat1 * Math.PI) / 180));
const hdops = Array.from(c.hdop);
const ascending = (xs: number[]) => [...xs].sort((a, b) => a - b);

describe('lower Manhattan walk', () => {
  it('fills in every field a GPX logger writes, with no problems', () => {
    expect(tr.problems).toEqual([]);
    expect(tr.fields).toEqual(['time', 'position', 'ele', 'speed', 'course', 'hdop', 'vdop', 'pdop', 'sats', 'fix', 'geoid', 'flags']);
    expect(tr.name).toBe('Lower Manhattan walk');
    // One fix a second for about 25 minutes, with two button presses (on the bridge and at the memorial).
    expect(tr.derived.stats.intervalS).toBe(1);
    expect(c.n).toBeGreaterThan(1300);
    expect(c.n).toBeLessThan(1800);
    expect(tr.flags.map((f) => f.n)).toEqual([1, 2]);
    expect(Array.from(c.geoid).every((g) => Math.abs(g + 32.7) < 1e-3)).toBe(true);
  });

  it('starts at Church and Chambers and ends at the North Pool of the 9/11 Memorial', () => {
    expect(meters(c.lat[0], c.lon[0], 40.715036, -74.008008)).toBeLessThan(12);
    expect(meters(c.lat[c.n - 1], c.lon[c.n - 1], 40.712299, -74.013487)).toBeLessThan(15);
    // About 1.6 km on foot.
    expect(tr.derived.stats.distanceM).toBeGreaterThan(1500);
    expect(tr.derived.stats.distanceM).toBeLessThan(2100);
  });

  it('climbs onto the Tribeca Bridge over West Street and comes back down', () => {
    // The flag is the pause halfway across the bridge.
    const i = Array.from(c.t).findIndex((t) => t >= tr.flags[0].t);
    expect(meters(c.lat[i], c.lon[i], 40.717441, -74.012926)).toBeLessThan(12);
    const median = (a: number, b: number) => { const xs = ascending(Array.from(c.ele.slice(i + a, i + b))); return xs[xs.length >> 1]; };
    // The deck is about 6.4 m above West Street, which is about 2.6 m above sea level there;
    // two minutes later the walker is back on the ground along Chambers St (about 4–5 m).
    const deck = median(-15, 15);
    expect(deck).toBeGreaterThan(7.5);
    expect(median(90, 150)).toBeLessThan(deck - 2.5);
  });

  it('gets a worse fix between the towers by the World Trade Center than out in the park', () => {
    // Fixes near the West St and Vesey St corner, and along the greenway north of the block.
    const near = (lat: number, lon: number, r: number) => hdops.filter((_, k) => meters(c.lat[k], c.lon[k], lat, lon) < r);
    const canyon = ascending(near(40.71367, -74.01356, 40)), open = ascending(near(40.71840, -74.01399, 40));
    expect(canyon.length).toBeGreaterThan(10);
    expect(open.length).toBeGreaterThan(10);
    expect(canyon[canyon.length >> 1]).toBeGreaterThan(open[open.length >> 1] + 0.4);
    // SBAS-corrected fixes in the open, and a short 2D stretch somewhere among the towers.
    expect(Array.from(c.fixq).some((q) => q === 2)).toBe(true);
  });

  it('stands still at the lights: the long wait to cross West Street at Murray Street', () => {
    let run = 0, longest = 0;
    for (let k = 1; k < c.n; k++) { run = c.speed[k] < 0.25 ? run + 1 : 0; longest = Math.max(longest, run); }
    expect(longest).toBeGreaterThanOrEqual(40);
  });
});

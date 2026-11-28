// @vitest-environment happy-dom
// The time zone list: every zone the browser knows, from the farthest west to
// the farthest east, each under the name its place has now.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/preact';
import { ZonePicker } from '../../src/ui/ZonePicker';
import { searchZones } from '../../src/time/zones';

const at = Date.UTC(2026, 10, 20, 12);
const zones = () => within(screen.getByRole('radiogroup', { name: 'Pick a time zone' })).getAllByRole('radio').map((b) => b.textContent);

function open() {
  render(<ZonePicker at={at} value="utc" onPick={() => {}} onClose={() => {}} trigger="#nothing" title="Pick a time zone" />);
}

describe('the time zone list', () => {
  it('lists every zone before a search, up to the last one east (UTC+14)', () => {
    open();
    const all = searchZones('', at);
    expect(all.length).toBeGreaterThan(200);
    expect(zones()).toHaveLength(all.length);
    expect(zones().at(-1)).toBe('KiritimatiPacific/KiritimatiUTC+14');
  });

  it('shows a zone the browser lists under an old name under its name now, found by either', () => {
    open();
    for (const q of ['calcutta', 'kolkata']) {
      fireEvent.input(screen.getByRole('searchbox'), { target: { value: q } });
      expect(zones()).toEqual(['KolkataAsia/KolkataUTC+5:30']);
    }
  });
});
